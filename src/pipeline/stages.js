import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { customAlphabet } from 'nanoid';
import { config } from '../config.js';
import { makeLogger } from '../logger.js';
import { makeRedactor } from './redact.js';
import { cloneRepo, workspacePath } from '../git/clone.js';
import { scanForServiceRoots } from '../scanner/scan.js';
import {
  classifyService,
  isFrontendServiceName,
  isBackendServiceName,
} from '../classifier/classify.js';
import { buildService } from '../builder/build.js';
import {
  runService,
  ensureNetwork,
  removeNetwork,
  healthCheck,
  captureContainerLogs,
} from '../runner/run.js';
import {
  ensureProxy,
  writeRoute,
  writeCombinedRoute,
  reloadProxy,
  removeRoutes,
  connectProxyToNetwork,
  disconnectProxyFromNetwork,
} from '../proxy/proxy.js';
import {
  createDeployment,
  setStatus,
  setUrls,
  setManifest,
  replaceServices,
  saveEnvVars,
  getEnvVars,
  getDeployment,
  updateServiceContainer,
  deleteDeployment,
} from '../state/deployments.js';
import { enqueue } from '../queue/queue.js';
import { inspectComposeFile } from '../compose/inspect.js';
import { writeComposeOverride } from '../compose/override.js';

const dockerSafeId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

export function newDeploymentId() {
  return dockerSafeId();
}

/* ------------------------------------------------------------------ *
 *  Stop / Start (container lifecycle, no teardown)
 * ------------------------------------------------------------------ */

/**
 * Stop every container in this deployment without removing it, remove the
 * deployment's proxy routes so its URLs stop resolving, and mark the
 * deployment `stopped`.
 */
export async function stopDeployment(deploymentId, { log } = {}) {
  const deployment = getDeployment(deploymentId);
  if (!deployment) throw new Error(`Unknown deployment ${deploymentId}`);

  const logger = log || makeLogger(deploymentId);
  logger(`Stopping deployment ${deploymentId}`);

  const dockerRun = (args) =>
    new Promise((resolve) => {
      const child = spawn('docker', args);
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });

  setStatus(deploymentId, 'stopping');

  for (const svc of deployment.services || []) {
    if (!svc.containerId) continue;
    logger(`Stopping container for ${svc.name}`);
    const ok = await dockerRun(['stop', svc.containerId]);
    if (!ok) logger(`Failed to stop container ${svc.containerId}`, 'err');
  }

  // Remove proxy routes so URLs stop resolving while stopped.
  try { await removeRoutes(deploymentId); }
  catch (e) { logger(`Could not remove proxy routes: ${e.message}`, 'err'); }

  setStatus(deploymentId, 'stopped');
  logger(`Deployment stopped.`);
  return getDeployment(deploymentId);
}

/**
 * Start every container that already exists for this deployment, re-run
 * health checks, and re-publish the proxy routes.
 */
export async function startDeployment(deploymentId, { log } = {}) {
  const deployment = getDeployment(deploymentId);
  if (!deployment) throw new Error(`Unknown deployment ${deploymentId}`);

  const logger = log || makeLogger(deploymentId);
  logger(`Starting deployment ${deploymentId}`);

  const dockerRun = (args) =>
    new Promise((resolve) => {
      const child = spawn('docker', args);
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { out += d.toString(); });
      child.on('error', () => resolve({ ok: false, out }));
      child.on('close', (code) => resolve({ ok: code === 0, out }));
    });

  setStatus(deploymentId, 'starting');

  // Start containers.
  for (const svc of deployment.services || []) {
    if (!svc.containerId) continue;
    logger(`Starting container for ${svc.name}`);
    const { ok, out } = await dockerRun(['start', svc.containerId]);
    if (!ok) {
      logger(`Failed to start ${svc.containerId}: ${out.trim()}`, 'err');
      setStatus(deploymentId, 'failed', `Failed to start container for ${svc.name}`);
      throw new Error(`Failed to start container for ${svc.name}`);
    }
  }

  // Determine the network to health-check on. Compose deployments use
  // <project>_default; non-compose deployments use cloudship-<id>-net.
  const composeNetwork = deployment.composePath
    ? await findComposeNetwork(`cloudship-${deploymentId}`)
    : null;
  const network = composeNetwork || `cloudship-${deploymentId}-net`;

  // Health-check + collect routing info.
  setStatus(deploymentId, 'health-check');

  const { db } = await import('../state/db.js');
  const routable = [];

    const ws = workspacePath(deploymentId);
  for (const svc of deployment.services || []) {
    if (!svc.port) {
      continue;
    }
    const containerName = `cloudship-${deploymentId}-${svc.name}`;
    const candidates = deployment.composePath
      ? [`cloudship-${deploymentId}-${svc.name}-1`, svc.name, containerName]
      : [containerName];

    // Best-effort Dockerfile lookup. For non-compose services the
    // Dockerfile lives at <workspace>/<rootPath>/Dockerfile. For compose
    // services we don't have the inspector here, so we try the service's
    // own rootPath — which will be '.' for most compose projects and
    // therefore point at the workspace root. If the file doesn't exist,
    // isNodeBasedService() returns false and the shell probe is used,
    // which is the previous behavior anyway.
    const dockerfilePath = path.join(ws, svc.rootPath || '.', 'Dockerfile');

    let ok = false;
    let usedName = containerName;
    for (const name of candidates) {
      ok = await healthCheck({
        containerName: name,
        port: svc.port,
        network,
        log: logger,
        service: { ...svc, __dockerfilePath: dockerfilePath },
      });
      if (ok) { usedName = name; break; }
    }
    if (!ok) {
      logger(`Health check failed for ${svc.name} on port ${svc.port}`, 'err');
      await captureContainerLogs(containerName, logger);
      setStatus(deploymentId, 'failed', `Health check failed for ${svc.name}`);
      throw new Error(`Health check failed for ${svc.name}`);
    }
    db.prepare(`UPDATE services SET containerStatus='healthy' WHERE deploymentId=? AND name=?`)
      .run(deploymentId, svc.name);
    routable.push({ svc, usedName });
  }

  // Re-publish proxy routes.
  try {
    await ensureProxy();
    await connectProxyToNetwork(network);

    const names = (deployment.services || []).map((s) => s.name);
    const frontendName = names.find((n) => isFrontendServiceName(n));
    const backendName = names.find((n) => isBackendServiceName(n));
    const canCombine =
      names.length === 2 && frontendName && backendName &&
      routable.some((r) => r.svc.name === frontendName) &&
      routable.some((r) => r.svc.name === backendName);

    const urls = [];

    if (canCombine) {
      const f = routable.find((r) => r.svc.name === frontendName);
      const b = routable.find((r) => r.svc.name === backendName);
      await writeCombinedRoute({
        deploymentId,
        frontend: { name: f.usedName, port: f.svc.port },
        backend: { name: b.usedName, port: b.svc.port },
      });
      urls.push(`${config.scheme}://${deploymentId}.${config.baseDomain}`);
    } else {
      for (const { svc, usedName } of routable) {
        await writeRoute({
          deploymentId,
          service: { name: svc.name, isPublic: true, alsoBare: routable.length === 1 },
          upstreamHost: usedName,
          upstreamPort: svc.port,
        });
        urls.push(`${config.scheme}://${deploymentId}-${svc.name}.${config.baseDomain}`);
      }
      if (routable.length === 1) {
        urls.push(`${config.scheme}://${deploymentId}.${config.baseDomain}`);
      }
    }

    await reloadProxy();
    setUrls(deploymentId, urls);
    logger(`Published URLs: ${urls.join(', ') || '(none)'}`);
  } catch (e) {
    logger(`Could not re-publish proxy routes: ${e.message}`, 'err');
    setStatus(deploymentId, 'failed', `Could not re-publish proxy routes: ${e.message}`);
    throw e;
  }

  setStatus(deploymentId, 'running');
  logger(`Deployment is running.`);
  return getDeployment(deploymentId);
}

/* ------------------------------------------------------------------ *
 *  Stages 1–4
 * ------------------------------------------------------------------ */

export async function detect(deploymentId, repoUrl, branch) {
  const log = makeLogger(deploymentId);
  try {
    setStatus(deploymentId, 'cloning');
    const repoRoot = await cloneRepo({ deploymentId, repoUrl, branch, log });

    const composeFile =
      fs.existsSync(path.join(repoRoot, 'docker-compose.yml')) ? 'docker-compose.yml' :
        fs.existsSync(path.join(repoRoot, 'compose.yml')) ? 'compose.yml' : null;

    if (composeFile) {
      log(`Compose file detected: ${composeFile}. Skipping stages 3-6.`);
      const manifest = { compose: true, services: [], composeFile };
      setManifest(deploymentId, manifest, true);
      setStatus(deploymentId, 'awaiting-confirmation');
      return manifest;
    }

    setStatus(deploymentId, 'scanning');
    const roots = scanForServiceRoots(repoRoot);
    log(`Found ${roots.length} candidate service root(s): ${roots.join(', ') || '(none)'}`);

    const services = roots.map((r) => classifyService(repoRoot, r));
    const manifest = { compose: false, services };
    setManifest(deploymentId, manifest, false);
    replaceServices(deploymentId, services);
    setStatus(deploymentId, 'awaiting-confirmation');
    return manifest;
  } catch (err) {
    log(`Detection failed: ${err.message}`, 'err');
    try { await teardown(deploymentId, { keepLog: true }); }
    catch (te) { log(`Teardown error during detect failure: ${te.message}`, 'err'); }
    setStatus(deploymentId, 'failed', err.message);
    throw err;
  }
}

/* ------------------------------------------------------------------ *
 *  Stages 5–7  —  non-compose path
 * ------------------------------------------------------------------ */

export async function deploy(deploymentId, confirmed) {
  return enqueue(async () => {
    const deployment = getDeployment(deploymentId);
    if (!deployment) throw new Error(`Unknown deployment ${deploymentId}`);

    const envRows = confirmed.envVars || [];
    saveEnvVars(deploymentId, envRows);
    const redactor = makeRedactor(envRows);
    const log = makeLogger(deploymentId, redactor);

    try {
      setManifest(deploymentId, confirmed, !!confirmed.compose);
      replaceServices(deploymentId, confirmed.services);

      const workspace = workspacePath(deploymentId);
      fs.mkdirSync(path.join(workspace, '.cloudship'), { recursive: true });
      fs.writeFileSync(
        path.join(workspace, '.cloudship', 'manifest.json'),
        JSON.stringify(confirmed, null, 2),
      );

      if (confirmed.compose) {
        return await deployCompose(deploymentId, workspace, envRows, log);
      }

      const publicServices = confirmed.services.filter((s) => s.isPublic);
      const urls = [];
      for (const s of publicServices) {
        s.alsoBare = publicServices.length === 1;
        urls.push(`${config.scheme}://${deploymentId}-${s.name}.${config.baseDomain}`);
        if (s.alsoBare) urls.push(`${config.scheme}://${deploymentId}.${config.baseDomain}`);
      }
      setUrls(deploymentId, urls);

      const staticSvc = confirmed.services.find((s) => s.type === 'static-site');
      const nodeSvc = confirmed.services.find((s) => s.type === 'node-server');
      const wireCross = staticSvc && nodeSvc;

      const backendUrlForFrontend =
        wireCross && nodeSvc.isPublic
          ? `${config.scheme}://${deploymentId}-${nodeSvc.name}.${config.baseDomain}`
          : null;
      const frontendUrlForBackend =
        wireCross && staticSvc.isPublic
          ? `${config.scheme}://${deploymentId}-${staticSvc.name}.${config.baseDomain}`
          : null;

      setStatus(deploymentId, 'building');
      const images = {};
      for (const svc of confirmed.services) {
        svc.buildArgs = {};
        svc.buildArgNames = [];

        if (
          svc.type === 'static-site' &&
          wireCross &&
          confirmed.frontendApiEnvVar &&
          backendUrlForFrontend
        ) {
          svc.buildArgNames.push(confirmed.frontendApiEnvVar);
          svc.buildArgs[confirmed.frontendApiEnvVar] = backendUrlForFrontend;
        }
        if (svc.type === 'static-site') {
          for (const row of envRows) {
            if (row.serviceName && row.serviceName !== svc.name) continue;
            if (!row.key) continue;
            if (svc.buildArgs[row.key] !== undefined) continue;
            svc.buildArgNames.push(row.key);
            svc.buildArgs[row.key] = row.value;
          }
        }

        images[svc.name] = await buildService({
          repoRoot: workspace,
          deploymentId,
          service: svc,
          log,
        });
      }

      setStatus(deploymentId, 'starting');
      const network = `cloudship-${deploymentId}-net`;
      await ensureNetwork(network);
      await ensureProxy();
      await connectProxyToNetwork(network);

      const containers = {};
      for (const svc of confirmed.services) {
        const env = {};
        for (const row of envRows) {
          if (row.serviceName && row.serviceName !== svc.name) continue;
          env[row.key] = row.value;
        }
        if (
          svc.type === 'node-server' &&
          wireCross &&
          confirmed.backendCorsEnvVar &&
          frontendUrlForBackend
        ) {
          env[confirmed.backendCorsEnvVar] = frontendUrlForBackend;
        }
        const { containerId, containerName } = await runService({
          deploymentId,
          network,
          service: svc,
          env,
          log,
        });
        containers[svc.name] = { containerId, containerName };
        updateServiceContainer(deploymentId, svc.name, {
          containerId,
          containerStatus: 'created',
        });
      }

      setStatus(deploymentId, 'health-check');
      for (const svc of confirmed.services) {
        const { containerName } = containers[svc.name];
        const ok = await healthCheck({
          containerName,
          port: svc.port,
          network,
          log,
          service: {
            ...svc,
            __dockerfilePath: path.join(workspace, svc.rootPath, 'Dockerfile'),
          },
        });
        if (!ok) {
          log(`Health check timed out for ${svc.name}`, 'err');
          await captureContainerLogs(containerName, log);
          throw new Error(
            `Health check timed out for service "${svc.name}" on port ${svc.port}`,
          );
        }
        updateServiceContainer(deploymentId, svc.name, {
          containerId: containers[svc.name].containerId,
          containerStatus: 'healthy',
        });
      }

      // Proxy rules for public services
      for (const svc of publicServices) {
        await writeRoute({
          deploymentId,
          service: svc,
          upstreamHost: containers[svc.name].containerName,
          upstreamPort: svc.port,
        });
      }

      await reloadProxy();

      setStatus(deploymentId, 'running');
      log(`Published URLs: ${urls.join(', ') || '(none)'}`);
      log('Deployment is running.');
      return getDeployment(deploymentId);
    } catch (err) {
      log(`Deployment failed: ${err.message}`, 'err');
      try { await teardown(deploymentId, { keepLog: true }); }
      catch (te) { log(`Teardown error during deploy failure: ${te.message}`, 'err'); }
      setStatus(deploymentId, 'failed', err.message);
      throw err;
    }
  });
}

/* ------------------------------------------------------------------ *
 *  Compose path
 * ------------------------------------------------------------------ */

async function deployCompose(deploymentId, workspace, envRows, log) {
  const project = `cloudship-${deploymentId}`;

  const composeFile =
    fs.existsSync(path.join(workspace, 'docker-compose.yml')) ? 'docker-compose.yml' :
      fs.existsSync(path.join(workspace, 'compose.yml')) ? 'compose.yml' : null;
  if (!composeFile) throw new Error('No compose file found at repo root');

  const run = (args, { allowFail = false, envOverride = null } = {}) =>
    new Promise((resolve, reject) => {
      const env = envOverride ? { ...process.env, ...envOverride } : { ...process.env };
      const child = spawn('docker', args, { cwd: workspace, env });
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); log(d.toString()); });
      child.stderr.on('data', (d) => { out += d.toString(); log(d.toString(), 'err'); });
      child.on('error', (e) => (allowFail ? resolve({ ok: false, err: e, out }) : reject(e)));
      child.on('close', (code) => {
        if (code === 0 || allowFail) resolve({ ok: code === 0, out, code });
        else reject(new Error(out || `docker ${args.join(' ')} exited ${code}`));
      });
    });

  log(`Pre-flight: cleaning any prior project state for ${project}`);
  await run(['compose', '-p', project, 'down', '--remove-orphans'], { allowFail: true });

  const inspected = inspectComposeFile(workspace, composeFile);
  const hardCoded = inspected.containerNames || {};
  const reclaimNames = Object.values(hardCoded).filter(Boolean);
  if (reclaimNames.length > 0) {
    log(`Detected hard-coded container names: ${reclaimNames.join(', ')}`);
    for (const name of reclaimNames) {
      await reclaimForeignContainer(name, project, log);
    }
  }

  // --- decide routing mode up front (affects baked API URL) --------------
  const names = inspected.serviceNames || [];
  const frontendName = names.find((n) => isFrontendServiceName(n));
  const backendName = names.find((n) => isBackendServiceName(n));
  const willUseCombined = names.length === 2 && !!frontendName && !!backendName;

  if (willUseCombined) {
    log(`Detected frontend+backend pair (${frontendName} + ${backendName}); using same-origin routing.`);
  }

  const publicBackendUrl = willUseCombined
    ? `${config.scheme}://${deploymentId}.${config.baseDomain}`
    : (backendName ? `${config.scheme}://${deploymentId}-${backendName}.${config.baseDomain}` : null);
  const publicFrontendUrl = willUseCombined
    ? `${config.scheme}://${deploymentId}.${config.baseDomain}`
    : (frontendName ? `${config.scheme}://${deploymentId}-${frontendName}.${config.baseDomain}` : null);

  const rewrittenEnvRows = envRows.map((r) => {
    if (!r || !r.key) return r;
    const val = typeof r.value === 'string' ? r.value : '';

    if (r.key === 'VITE_API_URL' || r.key === 'REACT_APP_API_URL') {
      return { ...r, value: willUseCombined ? '/api' : (publicBackendUrl ? `${publicBackendUrl}/api` : r.value) };
    }
    if (r.key === 'VITE_SOCKET_URL' || r.key === 'REACT_APP_SOCKET_URL') {
      return { ...r, value: willUseCombined ? '/' : (publicBackendUrl || r.value) };
    }
    if (r.key === 'VITE_BACKEND_URL' || r.key === 'REACT_APP_BACKEND_URL') {
      return { ...r, value: willUseCombined ? '' : (publicBackendUrl || r.value) };
    }
    if (r.key === 'FRONTEND_URL' || r.key === 'CLIENT_URL' || r.key === 'CORS_ORIGIN') {
      return { ...r, value: publicFrontendUrl || r.value };
    }

    const m = val.match(/^http:\/\/localhost:(\d+)(\/.*)?$/);
    if (m) {
      const rest = m[2] || '';
      const looksLikeApi = /\/(api|socket|ws|graphql)/i.test(rest) || /api|socket/i.test(r.key);
      if (looksLikeApi && publicBackendUrl) return { ...r, value: `${publicBackendUrl}${rest}` };
      if (!looksLikeApi && publicFrontendUrl) return { ...r, value: `${publicFrontendUrl}${rest}` };
    }
    return r;
  });

  const globalEnv = rewrittenEnvRows.filter((r) => r && r.key && !r.serviceName);
  if (globalEnv.length > 0) {
    fs.writeFileSync(
      path.join(workspace, '.env'),
      globalEnv.map((r) => `${r.key}=${r.value}`).join('\n') + '\n',
    );
  }

  // Write build-time env files into frontend build contexts.
  for (const serviceName of names) {
    if (!isFrontendServiceName(serviceName)) continue;
    writeFrontendEnvFiles(workspace, inspected, serviceName, rewrittenEnvRows, log);
  }

  const { args: composeArgs } = writeComposeOverride(workspace, composeFile, inspected, rewrittenEnvRows);
  log(`Using compose invocation: docker compose -p ${project} ${composeArgs.join(' ')} up -d --build`);

  setStatus(deploymentId, 'building');
  const composeEnv = {};
  for (const r of rewrittenEnvRows) composeEnv[r.key] = r.value;
  await run(
    ['compose', '-p', project, ...composeArgs, 'up', '-d', '--build'],
    { envOverride: composeEnv },
  );

  const composeNetwork = await findComposeNetwork(project);

  // --- attach proxy to the compose network (once) -------------------------
  await ensureProxy();
  if (composeNetwork) {
    log(`Attaching proxy to compose network ${composeNetwork}`);
    await connectProxyToNetwork(composeNetwork);
  }

  const { out: psOut } = await run([
    'compose', '-p', project, ...composeArgs, 'ps', '--format', 'json',
  ]);
  const containers = psOut
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

  const services = containers.map((c) => ({
    name: c.Service,
    rootPath: '.',
    type: 'compose',
    port: extractInternalPort(c),
    isPublic: true,
    containerId: c.ID,
    containerStatus: c.State,
  }));

  const { db } = await import('../state/db.js');
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM services WHERE deploymentId=?`).run(deploymentId);
    const ins = db.prepare(`INSERT INTO services
      (deploymentId, name, rootPath, type, port, isPublic, containerId, containerStatus)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (const s of services) {
      ins.run(deploymentId, s.name, '.', 'compose', s.port ?? null, 1, s.containerId, s.containerStatus);
    }
  });
  tx();

  setStatus(deploymentId, 'health-check');
  for (const c of containers) {
    const internalPort = extractInternalPort(c);
    if (!internalPort) {
      log(`Skipping health check for ${c.Service}: no discoverable internal port`, 'warn');
      continue;
    }
    const containerName = c.Name || c.Service;
    // Look up the service's build context from the inspector so we can
    // point __dockerfilePath at the actual Dockerfile, if there is one.
    const ctxRel = inspected.buildContexts?.[c.Service];
    const dockerfilePath = ctxRel
      ? path.join(workspace, ctxRel, 'Dockerfile')
      : null;
    const ok = await healthCheck({
      containerName,
      port: internalPort,
      network: composeNetwork,
      log,
      service: {
        name: c.Service,
        type: 'compose',
        __dockerfilePath: dockerfilePath,
      },
    });
    if (!ok) {
      log(`Health check did not pass for ${c.Service}; continuing anyway.`, 'err');
      await captureContainerLogs(containerName, log);
      db.prepare(`UPDATE services SET containerStatus='unhealthy' WHERE deploymentId=? AND name=?`)
        .run(deploymentId, c.Service);
      continue;
    }
    db.prepare(`UPDATE services SET containerStatus='healthy' WHERE deploymentId=? AND name=?`)
      .run(deploymentId, c.Service);
  }

  const urls = [];
  const routable = [];
  for (const c of containers) {
    const internalPort = extractInternalPort(c);
    if (!internalPort) {
      log(`Marking ${c.Service} not-public: no discoverable internal port`, 'err');
      db.prepare(`UPDATE services SET isPublic=0 WHERE deploymentId=? AND name=?`)
        .run(deploymentId, c.Service);
      continue;
    }
    routable.push({ container: c, port: internalPort });
  }

  const containerByName = Object.fromEntries(routable.map((r) => [r.container.Service, r]));

  if (willUseCombined && containerByName[frontendName] && containerByName[backendName]) {
    const f = containerByName[frontendName];
    const b = containerByName[backendName];
    await writeCombinedRoute({
      deploymentId,
      frontend: { name: f.container.Name || f.container.Service, port: f.port },
      backend: { name: b.container.Name || b.container.Service, port: b.port },
    });
    urls.push(`${config.scheme}://${deploymentId}.${config.baseDomain}`);
    log(`Using combined same-origin route at ${config.scheme}://${deploymentId}.${config.baseDomain}`);
  } else {
    for (const { container: c, port } of routable) {
      const upstreamHost = c.Name || c.Service;
      await writeRoute({
        deploymentId,
        service: {
          name: c.Service,
          isPublic: true,
          alsoBare: routable.length === 1,
        },
        upstreamHost,
        upstreamPort: port,
      });
      urls.push(`${config.scheme}://${deploymentId}-${c.Service}.${config.baseDomain}`);
    }
    if (routable.length === 1) {
      urls.push(`${config.scheme}://${deploymentId}.${config.baseDomain}`);
    }
  }

  await reloadProxy();
  setUrls(deploymentId, urls);
  log(`Published URLs: ${urls.join(', ') || '(none)'}`);
  log(
    `Note: proxy currently serves plain HTTP on port 80. For local access, ` +
    `add "/etc/hosts" entries for the hostnames above and use ${config.scheme}:// instead of https://.`,
  );

  setStatus(deploymentId, 'running');
  log(`Compose deployment running with ${services.length} container(s).`);
  return getDeployment(deploymentId);
}

/* ------------------------------------------------------------------ *
 *  Frontend build-time env files
 * ------------------------------------------------------------------ */

/**
 * Detect the frontend framework of a service by reading its package.json.
 * Returns 'vite' | 'cra' | 'unknown'.
 */
function detectFrontendFramework(ctxAbs) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ctxAbs, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps['vite']) return 'vite';
    if (deps['react-scripts']) return 'cra';
    return 'unknown';
  } catch { return 'unknown'; }
}

/**
 * Read a .dockerignore and determine whether any of the given filenames
 * would be excluded. Returns the matching pattern, or null.
 */
function dockerignoreExcludes(ctxAbs, filenames) {
  const ignorePath = path.join(ctxAbs, '.dockerignore');
  if (!fs.existsSync(ignorePath)) return null;

  let lines;
  try { lines = fs.readFileSync(ignorePath, 'utf8').split(/\r?\n/); }
  catch { return null; }

  const patterns = lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  for (const pattern of patterns) {
    const rx = new RegExp(
      '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$'
    );
    for (const name of filenames) {
      if (rx.test(name) || rx.test(`./${name}`)) return pattern;
    }
  }
  return null;
}

/**
 * Write .env.production / .env.local / .env into a frontend's build context.
 * Works for Vite (VITE_*) and CRA (REACT_APP_*) — the framework is detected
 * from the build context's package.json.
 *
 * Warns (does not modify) if the service's .dockerignore excludes .env files.
 */
function writeFrontendEnvFiles(workspace, inspected, service, envRows, log) {
  const ctxRel = inspected.buildContexts?.[service];
  if (!ctxRel) {
    log(`No build context found for ${service}; skipping frontend env write`, 'warn');
    return;
  }
  const ctxAbs = path.resolve(workspace, ctxRel);
  if (!fs.existsSync(ctxAbs)) {
    log(`Build context ${ctxRel} for ${service} does not exist; skipping`, 'warn');
    return;
  }

  const framework = detectFrontendFramework(ctxAbs);
  const prefix = framework === 'cra' ? /^REACT_APP_/ : /^VITE_/;

  const rows = envRows.filter(
    (r) => r && r.key && prefix.test(r.key) && (!r.serviceName || r.serviceName === service),
  );
  if (rows.length === 0) {
    return;
  }

  const filenames = ['.env.production', '.env.local', '.env'];
  const excluded = dockerignoreExcludes(ctxAbs, filenames);
  if (excluded) {
    log(
      `This repo's .dockerignore (pattern "${excluded}") excludes .env files; ` +
      `build-time variables will not reach the image.`,
      'err',
    );
  }

  const contents = rows.map((r) => `${r.key}=${r.value}`).join('\n') + '\n';
  for (const name of filenames) {
    try {
      fs.writeFileSync(path.join(ctxAbs, name), contents);
    } catch (e) {
      log(`Could not write ${name} into ${ctxRel}: ${e.message}`, 'err');
    }
  }
  log(`Wrote ${rows.length} ${framework === 'cra' ? 'CRA' : 'Vite'} var(s) into ${ctxRel}/.env.production`);
}

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

async function findComposeNetwork(project) {
  const preferred = `${project}_default`;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('docker', ['network', 'inspect', preferred]);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error('no net')));
      child.on('error', reject);
    });
    return preferred;
  } catch { /* fall through */ }

  return await new Promise((resolve) => {
    const child = spawn('docker', ['network', 'ls', '--format', '{{.Name}}']);
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('close', () => {
      const match = out.split('\n').find((n) => n.startsWith(project));
      resolve(match || null);
    });
    child.on('error', () => resolve(null));
  });
}

function extractInternalPort(container) {
  const publishers = container?.Publishers || [];
  const withTarget = publishers.find((p) => p && p.TargetPort);
  if (withTarget?.TargetPort) return withTarget.TargetPort;
  const portsStr = container?.Ports || '';
  const m = portsStr.match(/->(\d+)\//);
  if (m) return Number(m[1]);
  return null;
}

async function reclaimForeignContainer(name, project, log) {
  const inspect = await dockerJson(['inspect', name]);
  if (!inspect) return;
  const labels = inspect.Config?.Labels || {};
  const owner = labels['com.docker.compose.project'];
  if (owner === project) return;
  log(`Reclaiming container name "${name}" (currently owned by project "${owner ?? 'unknown'}")`);
  await dockerQuiet(['rm', '-f', name]);
}

function dockerJson(args) {
  return new Promise((resolve) => {
    const child = spawn('docker', args);
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', () => { });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(out)[0]); } catch { resolve(null); }
    });
  });
}

function dockerQuiet(args) {
  return new Promise((resolve) => {
    const child = spawn('docker', args);
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
}

/* ------------------------------------------------------------------ *
 *  Teardown
 * ------------------------------------------------------------------ */

export async function teardown(deploymentId, { keepLog = false } = {}) {
  const log = makeLogger(deploymentId);
  const deployment = getDeployment(deploymentId);

  const dockerQuiet = (args) =>
    new Promise((resolve) => {
      const child = spawn('docker', args);
      child.on('error', () => resolve());
      child.on('close', () => resolve());
    });

  if (deployment?.services?.length) {
    for (const s of deployment.services) {
      if (s.containerId) {
        log(`Removing container for ${s.name}`);
        await dockerQuiet(['rm', '-f', s.containerId]);
      }
    }
  }

  if (deployment?.composePath) {
    const ws = workspacePath(deploymentId);
    if (fs.existsSync(ws)) {
      await new Promise((resolve) => {
        const child = spawn(
          'docker',
          ['compose', '-p', `cloudship-${deploymentId}`, 'down', '--rmi', 'local', '--volumes'],
          { cwd: ws },
        );
        child.on('close', resolve);
        child.on('error', resolve);
      });
    }
  }

  for (const s of deployment?.services || []) {
    await dockerQuiet(['rmi', '-f', `cloudship-${deploymentId}-${s.name}:latest`]);
  }

  await disconnectProxyFromNetwork(`cloudship-${deploymentId}-net`);
  await removeNetwork(`cloudship-${deploymentId}-net`);

  await removeRoutes(deploymentId);

  fs.rmSync(workspacePath(deploymentId), { recursive: true, force: true });

  if (!keepLog) log('Teardown complete.');
}