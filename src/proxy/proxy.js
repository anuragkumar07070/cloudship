import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';

function docker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
  });
}

/**
 * Remove route files in conf.d whose deployment id no longer exists in the
 * deployments table (or is in a terminal state that never routes).
 * Runs before nginx is (re)started so a fresh proxy never inherits routes
 * pointing at dead containers.
 */
async function pruneOrphanedRoutes() {
  const dir = path.join(config.proxyDir, 'conf.d');
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.conf'));
  if (files.length === 0) return;

  let validIds;
  try {
    const { db } = await import('../state/db.js');
    const rows = db
      .prepare(`SELECT id FROM deployments WHERE status IN ('running','stopped')`)
      .all();
    validIds = new Set(rows.map((r) => r.id));
  } catch {
    // If we can't consult the DB, don't delete anything — safer default.
    return;
  }

  let pruned = 0;
  for (const f of files) {
    // Filenames are `<deploymentId>-<service>.conf` or `<deploymentId>-combined.conf`.
    const m = f.match(/^([a-z0-9]+)-/);
    if (!m) continue;
    const id = m[1];
    if (validIds.has(id)) continue;
    try {
      fs.rmSync(path.join(dir, f));
      pruned++;
    } catch { /* best-effort */ }
  }
  if (pruned > 0) {
    // eslint-disable-next-line no-console
    console.log(`[proxy] pruned ${pruned} orphaned route file(s)`);
  }
}

export async function ensureProxy() {
  fs.mkdirSync(path.join(config.proxyDir, 'conf.d'), { recursive: true });

  // Explicit default server: unmatched Host headers get a clean 404.
  const defaultConf = path.join(config.proxyDir, 'conf.d', '00-default.conf');
  if (!fs.existsSync(defaultConf)) {
    fs.writeFileSync(defaultConf, `
server {
  listen 80 default_server;
  server_name _;
  return 404;
}
`.trimStart());
  }

  // Remove routes for deployments that no longer exist before we start nginx.
  await pruneOrphanedRoutes();

  try { await docker(['network', 'inspect', config.proxyNetwork]); }
  catch { await docker(['network', 'create', config.proxyNetwork]); }

  // --- Liveness check ----------------------------------------------------
  // `docker inspect` succeeds for stopped containers too, so check
  // State.Running specifically.
  let runningState = null;
  try {
    const out = await docker([
      'inspect', '--format', '{{.State.Running}}', config.proxyContainer,
    ]);
    runningState = out.trim();
  } catch {
    runningState = null; // container doesn't exist
  }

  if (runningState === 'true') {
    return; // already running
  }

  if (runningState === 'false') {
    // Container exists but is stopped/crashed. Try to start it.
    try {
      await docker(['start', config.proxyContainer]);
      return;
    } catch (e) {
      // Couldn't start — fall through and recreate it.
      // eslint-disable-next-line no-console
      console.warn(`[proxy] could not start existing container: ${String(e.message || e)}`);
      try { await docker(['rm', '-f', config.proxyContainer]); } catch { /* ignore */ }
    }
  }

  // --- Create fresh ------------------------------------------------------
  await docker([
    'run', '-d',
    '--name', config.proxyContainer,
    '--restart', 'unless-stopped',
    '--network', config.proxyNetwork,
    '-p', '80:80',
    '-v', `${path.join(config.proxyDir, 'conf.d')}:/etc/nginx/conf.d:ro`,
    'nginx:alpine',
  ]);

  // Sanity: is it still up?
  try {
    const out = await docker([
      'inspect', '--format', '{{.State.Running}}', config.proxyContainer,
    ]);
    if (out.trim() !== 'true') {
      // eslint-disable-next-line no-console
      console.error('[proxy] proxy container was created but is not running — check `docker logs cloudship-proxy`');
    }
  } catch { /* ignore */ }
}

export async function connectProxyToNetwork(network) {
  try {
    await docker(['network', 'connect', network, config.proxyContainer]);
  } catch (e) {
    const msg = String(e.message || e);
    if (!/already exists|already connected/i.test(msg)) throw e;
  }
}

export async function disconnectProxyFromNetwork(network) {
  try {
    await docker(['network', 'disconnect', network, config.proxyContainer]);
  } catch { /* not connected, network gone, or proxy gone — fine */ }
}

export async function writeRoute({ deploymentId, service, upstreamHost, upstreamPort }) {
  const safeName = `${deploymentId}-${service.name}`.replace(/[^a-zA-Z0-9-]/g, '-');
  const hostHeader = `${deploymentId}-${service.name}.${config.baseDomain}`;
  const bareHost = `${deploymentId}.${config.baseDomain}`;

  const conf = `
server {
  listen 80;
  server_name ${hostHeader}${service.isPublic && service.alsoBare ? ' ' + bareHost : ''};
  location / {
    proxy_pass http://${upstreamHost}:${upstreamPort};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
`.trimStart();

  const file = path.join(config.proxyDir, 'conf.d', `${safeName}.conf`);
  fs.writeFileSync(file, conf);
  return file;
}

export async function writeCombinedRoute({ deploymentId, frontend, backend }) {
  const host = `${deploymentId}.${config.baseDomain}`;
  const safeName = `${deploymentId}-combined`.replace(/[^a-zA-Z0-9-]/g, '-');

  const conf = `
server {
  listen 80;
  server_name ${host};

  location /api/ {
    proxy_pass http://${backend.name}:${backend.port};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://${frontend.name}:${frontend.port}/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
`.trimStart();

  const file = path.join(config.proxyDir, 'conf.d', `${safeName}.conf`);
  fs.writeFileSync(file, conf);
  return file;
}

/**
 * Validate config first, then reload. Loud on failure.
 */
export async function reloadProxy() {
  // Validate before reloading.
  try {
    await docker(['exec', config.proxyContainer, 'nginx', '-t']);
  } catch (e) {
    const msg = String(e.message || e);
    // eslint-disable-next-line no-console
    console.error(`[proxy] nginx config validation FAILED — reload skipped:\n${msg}`);
    return;
  }

  try {
    await docker(['exec', config.proxyContainer, 'nginx', '-s', 'reload']);
  } catch (e) {
    const msg = String(e.message || e);
    // eslint-disable-next-line no-console
    console.error(`[proxy] nginx reload FAILED: ${msg}`);
  }
}

export async function removeRoutes(deploymentId) {
  const dir = path.join(config.proxyDir, 'conf.d');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(deploymentId)) fs.rmSync(path.join(dir, f), { force: true });
  }
  await reloadProxy();
}