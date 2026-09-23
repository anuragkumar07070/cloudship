import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

function docker(args, { log } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args);
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); log && log(d.toString()); });
    child.stderr.on('data', (d) => log && log(d.toString(), 'err'));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`docker ${args.join(' ')} exited ${code}`)));
  });
}

export async function ensureNetwork(network) {
  try { await docker(['network', 'inspect', network]); }
  catch { await docker(['network', 'create', network]); }
}

export async function removeNetwork(network) {
  try { await docker(['network', 'rm', network]); } catch {}
}

export async function runService({ deploymentId, network, service, env, log }) {
  const containerName = `cloudship-${deploymentId}-${service.name}`;
  const imageTag = `cloudship-${deploymentId}-${service.name}:latest`;

  try { await docker(['rm', '-f', containerName]); } catch {}

  const args = [
    'run', '-d',
    '--name', containerName,
    '--network', network,
    '--memory', config.memoryLimit,
    '--cpus', config.cpuLimit,
  ];
  for (const [k, v] of Object.entries(env)) {
    if (!k || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      log(`Skipping invalid env key: ${JSON.stringify(k)}`, 'err');
      continue;
    }
    args.push('-e', `${k}=${v}`);
  }
  args.push(imageTag);

  log(`Starting container ${containerName}`);
  const containerId = await docker(args, { log });
  return { containerId, containerName };
}

/* ------------------------------------------------------------------ *
 *  Probing strategy
 *
 *  healthCheck() polls with these probes in order, per attempt:
 *
 *  1. Node-exec probe  — for node-based services (node-server, or
 *     dockerfile-provided with a node:* base image). Uses `node -e` which
 *     is guaranteed present in any node image.
 *  2. Shell probe      — wget / nc via `sh -lc`. Works for nginx/alpine
 *     static-sites, and is a fallback for node images missing a shell.
 *  3. Host-side probe  — resolve the container's IP on the deployment
 *     network and TCP-connect from the host. Last resort if `docker exec`
 *     itself is unavailable.
 *
 *  Only "exec could not run the probe" (command not found, exec failed)
 *  advances to the next strategy. A probe that runs and returns non-zero
 *  means the app is up but not ready — the loop retries the same strategy.
 * ------------------------------------------------------------------ */

/**
 * Resolve the container's IP address on the given network.
 * Uses the full Networks JSON map and falls back across networks, so it
 * works even when the container is multi-homed.
 */
function containerIpOnNetwork(containerName, network) {
  return new Promise((resolve) => {
    const child = spawn('docker', [
      'inspect',
      '--format',
      '{{json .NetworkSettings.Networks}}',
      containerName,
    ]);
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', () => {});
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      let networks;
      try { networks = JSON.parse(out.trim()); }
      catch { return resolve(null); }
      if (!networks || typeof networks !== 'object') return resolve(null);

      if (network && networks[network]?.IPAddress) {
        return resolve(networks[network].IPAddress);
      }
      if (network) {
        for (const [name, cfg] of Object.entries(networks)) {
          if (name.endsWith(`_${network}`) && cfg?.IPAddress) {
            return resolve(cfg.IPAddress);
          }
        }
      }
      for (const cfg of Object.values(networks)) {
        if (cfg?.IPAddress) return resolve(cfg.IPAddress);
      }
      resolve(null);
    });
  });
}

function tcpProbe(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(2_000);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/**
 * Is this service's image node-based?
 *   - node-server → yes
 *   - dockerfile-provided → only if the Dockerfile's first FROM uses
 *     `node:` or `node@`
 * Everything else (static-site, unknown) → no.
 */
function isNodeBasedService(service) {
  if (!service) return false;
  if (service.type === 'node-server') return true;
  // Accept both dockerfile-provided and compose services. The compose
  // call site in stages.js builds its service object with type: 'compose',
  // so this guard must not reject it — otherwise the node probe never
  // fires for the primary use case (compose-based deployments).
  if (service.type !== 'dockerfile-provided' && service.type !== 'compose') {
    return false;
  }

  const df = service.__dockerfilePath;
  if (!df) return false;
  try {
    const text = fs.readFileSync(df, 'utf8');
    const matches = [...text.matchAll(/^\s*FROM\s+([^\s]+)/gim)];
    if (matches.length === 0) return false;
    // Take the LAST FROM — that's the runtime stage in a multi-stage build.
    const base = matches[matches.length - 1][1].toLowerCase();
    return base.startsWith('node:') || base.startsWith('node@');
  } catch { return false; }
}

/**
 * Run a command inside the container.
 * Returns:
 *   { ran: true,  ok: true }   probe ran, app responded successfully
 *   { ran: true,  ok: false }  probe ran, app responded with an error
 *   { ran: false }             probe could not run (no shell, no binary,
 *                              docker exec disabled, container gone, …)
 */
function execProbe(containerName, cmdArgs) {
  return new Promise((resolve) => {
    const child = spawn('docker', ['exec', containerName, ...cmdArgs]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', () => resolve({ ran: false }));
    child.on('close', (code) => {
      // --- TEMP LOG: remove after verifying strategy selection ---
      const kind = cmdArgs[0] === 'node' ? 'node' : (cmdArgs[0] === 'sh' ? 'wget/nc' : cmdArgs[0]);
      // eslint-disable-next-line no-console
      console.log(`[probe] ${containerName} strategy=${kind} ran=true code=${code}`);
      // -----------------------------------------------------------

      if (code === 0) return resolve({ ran: true, ok: true });
      const err = `${stdout}\n${stderr}`;
      const execFailed =
        code === 125 || code === 126 || code === 127 ||
        /executable file not found|no such file or directory|OCI runtime exec failed|not found in \$PATH/i.test(err);
      if (execFailed) {
        // eslint-disable-next-line no-console
        console.log(`[probe] ${containerName} strategy=${kind} ran=false (exec failed)`);
        return resolve({ ran: false });
      }
      resolve({ ran: true, ok: false });
    });
  });
}

/**
 * Node-based probe: use the guaranteed-present `node` binary to make an
 * HTTP GET against 127.0.0.1:<port>. Exits 0 if status < 500, else 1.
 * Uses https for ports conventionally TLS (443); http otherwise.
 */
async function probeWithNode(containerName, port) {
  const scheme = port === 443 ? 'https' : 'http';
  const script =
    `require('${scheme === 'https' ? 'https' : 'http'}')` +
    `.get('${scheme}://127.0.0.1:${port}/', r => process.exit(r.statusCode < 500 ? 0 : 1))` +
    `.on('error', () => process.exit(1));`;
  return execProbe(containerName, ['node', '-e', script]);
}

/**
 * Shell probe: use wget (present in nginx:alpine) then nc, from within the
 * container's shell. Works for alpine-based static-sites and most distros.
 */
async function probeWithShell(containerName, port) {
  const cmd =
    `wget -q -T 2 -O /dev/null --spider http://127.0.0.1:${port}/ 2>/dev/null || ` +
    `nc -z -w 2 127.0.0.1 ${port} >/dev/null 2>&1`;
  return execProbe(containerName, ['sh', '-lc', cmd]);
}

/**
 * Host-side probe: resolve the container's IP on the deployment network
 * and TCP-probe it directly. Used only when docker exec itself is not
 * available (e.g. restricted environments).
 */
async function probeFromHost(containerName, port, network) {
  const ip = await containerIpOnNetwork(containerName, network);
  if (!ip) {
    // eslint-disable-next-line no-console
    console.log(`[probe] ${containerName} strategy=host-ip ran=false (no IP)`);
    return { ran: false };
  }
  const ok = await tcpProbe(ip, port);
  // eslint-disable-next-line no-console
  console.log(`[probe] ${containerName} strategy=host-ip ran=true ip=${ip} port=${port} ok=${ok}`);
  return { ran: true, ok };
}
/**
 * Probe strategy per call. Returns true on success; false otherwise (the
 * caller retries until the deadline). Picks the strategy based on the
 * service type; the loop is agnostic.
 */
async function probeInside({ containerName, port, network, service }) {
  const nodeBased = isNodeBasedService(service);

  if (nodeBased) {
    const r = await probeWithNode(containerName, port);
    if (r.ran) return r.ok;
    // Fall through to shell probe for node images missing a shell.
  }

  const s = await probeWithShell(containerName, port);
  if (s.ran) return s.ok;

  // Last resort: host-side IP probe.
  const h = await probeFromHost(containerName, port, network);
  if (h.ran) return h.ok;

  return false;
}

/**
 * Poll the service's declared port over the deployment network until success.
 * Delegates the actual probing to probeInside(); retries on failure until
 * config.healthTimeoutMs elapses.
 */
export async function healthCheck({ containerName, port, network, log, service }) {
  const deadline = Date.now() + config.healthTimeoutMs;
  let lastAttemptLogged = 0;
  while (Date.now() < deadline) {
    const ok = await probeInside({ containerName, port, network, service });
    if (ok) {
      log(`Health check passed for ${containerName}:${port}`);
      return true;
    }
    // Log occasionally so the log isn't silent during a long poll.
    const elapsed = Date.now() - (deadline - config.healthTimeoutMs);
    if (elapsed - lastAttemptLogged >= 10_000) {
      lastAttemptLogged = elapsed;
      log(`Waiting for ${containerName}:${port} to accept connections…`);
    }
    await sleep(config.healthIntervalMs);
  }
  log(`Health check timed out probing ${containerName}:${port}`, 'err');
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function captureContainerLogs(containerName, log) {
  try {
    const out = await docker(['logs', '--tail', '200', containerName]);
    log(out);
  } catch (e) {
    log(`Could not capture logs for ${containerName}: ${e.message}`, 'err');
  }
}