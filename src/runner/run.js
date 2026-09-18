import { spawn } from 'node:child_process';
import net from 'node:net';
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

  // best-effort cleanup of a same-named container from a prior attempt
  try { await docker(['rm', '-f', containerName]); } catch {}

  const args = [
    'run', '-d',
    '--name', containerName,
    '--network', network,
    '--memory', config.memoryLimit,
    '--cpus', config.cpuLimit,
  ];
  for (const [k, v] of Object.entries(env)) {
    args.push('-e', `${k}=${v}`);
  }
  args.push(imageTag);

  log(`Starting container ${containerName}`);
  const containerId = await docker(args, { log });
  return { containerId, containerName };
}
// src/runner/run.js — replace healthCheck + tcpProbe

/**
 * Resolve the container's IP address on the given network.
 * Uses the full Networks JSON map and falls back across networks, so it
 * works even when the container is multi-homed (e.g. compose projects that
 * join multiple networks).
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

      // 1. Exact match.
      if (network && networks[network]?.IPAddress) {
        return resolve(networks[network].IPAddress);
      }

      // 2. Compose often prefixes with the project name: try endsWith.
      if (network) {
        for (const [name, cfg] of Object.entries(networks)) {
          if (name.endsWith(`_${network}`) && cfg?.IPAddress) {
            return resolve(cfg.IPAddress);
          }
        }
      }

      // 3. Any network with an IP.
      for (const cfg of Object.values(networks)) {
        if (cfg?.IPAddress) return resolve(cfg.IPAddress);
      }
      resolve(null);
    });
  });
}

/**
 * Poll the service's declared port over the deployment network until success.
 * Resolves the container's IP on the network and TCP-probes that IP directly,
 * since container-name DNS is not resolvable from the host process.
 */
export async function healthCheck({ containerName, port, network, log }) {
  const deadline = Date.now() + config.healthTimeoutMs;
  while (Date.now() < deadline) {
    const ok = await probeInside(containerName, port);
    if (ok) {
      log(`Health check passed for ${containerName}:${port} (self-probe)`);
      return true;
    }
    await sleep(config.healthIntervalMs);
  }
  return false;
}

function probeInside(containerName, port) {
  return new Promise((resolve) => {
    const child = spawn('docker', [
      'exec', containerName,
      'sh', '-lc',
      `wget -q -T 2 -O /dev/null --spider http://127.0.0.1:${port}/ 2>/dev/null || \
       nc -z -w 2 127.0.0.1 ${port} >/dev/null 2>&1`,
    ]);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function captureContainerLogs(containerName, log) {
  try {
    const out = await docker(['logs', '--tail', '200', containerName]);
    log(out);
  } catch (e) {
    log(`Could not capture logs for ${containerName}: ${e.message}`, 'err');
  }
}