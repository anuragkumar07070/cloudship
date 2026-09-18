import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';

/**
 * Reverse-proxy strategy: an nginx container attached to the deployment
 * network. Each deployment writes a site config into a shared conf.d
 * directory and reloads nginx.
 */
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

export async function ensureProxy() {
  fs.mkdirSync(path.join(config.proxyDir, 'conf.d'), { recursive: true });
  try { await docker(['network', 'inspect', config.proxyNetwork]); }
  catch { await docker(['network', 'create', config.proxyNetwork]); }

  try { await docker(['inspect', config.proxyContainer]); return; }
  catch { /* not running */ }

  await docker([
    'run', '-d',
    '--name', config.proxyContainer,
    '--network', config.proxyNetwork,
    '-p', '80:80',
    '-v', `${path.join(config.proxyDir, 'conf.d')}:/etc/nginx/conf.d:ro`,
    'nginx:alpine',
  ]);
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

/**
 * Per-service server block. Used when a deployment is NOT collapsed to a
 * single same-origin host (more than two public services, or names don't
 * look like frontend+backend).
 */
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

/**
 * One server block that routes both /api/* (to backend) and /* (to
 * frontend) for a deployment with a frontend/backend pair. Same-origin
 * means no CORS, no cross-site cookies, no cross-subdomain build URLs.
 */
export async function writeCombinedRoute({
  deploymentId,
  frontend,
  backend,
}) {
  const host = `${deploymentId}.${config.baseDomain}`;
  const safeName = `${deploymentId}-combined`.replace(/[^a-zA-Z0-9-]/g, '-');

  const conf = `
server {
  listen 80;
  server_name ${host};

  # IMPORTANT: no trailing slash on proxy_pass — keeps the /api prefix
  # intact so the backend sees /api/auth/shop/login, not /auth/shop/login.
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

export async function reloadProxy() {
  try { await docker(['exec', config.proxyContainer, 'nginx', '-s', 'reload']); }
  catch { /* proxy may not be up in dev */ }
}

export async function removeRoutes(deploymentId) {
  const dir = path.join(config.proxyDir, 'conf.d');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(deploymentId)) fs.rmSync(path.join(dir, f), { force: true });
  }
  await reloadProxy();
}