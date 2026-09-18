import path from 'node:path';
import os from 'node:os';

export const config = {
  port: Number(process.env.PORT || 4000),
  baseDomain: process.env.CLOUDSHIP_BASE_DOMAIN || 'localhost',
  workspaceRoot: process.env.CLOUDSHIP_WORKSPACE || path.join(os.tmpdir(), 'cloudship'),
  dbPath: process.env.CLOUDSHIP_DB || path.join(process.cwd(), 'data', 'cloudship.db'),
  proxyDir: process.env.CLOUDSHIP_PROXY_DIR || path.join(process.cwd(), 'data', 'proxy'),
  proxyContainer: process.env.CLOUDSHIP_PROXY_CONTAINER || 'cloudship-proxy',
  proxyNetwork: process.env.CLOUDSHIP_PROXY_NETWORK || 'cloudship-proxy-net',
  concurrency: Number(process.env.CLOUDSHIP_CONCURRENCY || 1),
  memoryLimit: process.env.CLOUDSHIP_MEMORY || '512m',
  logDir: process.env.CLOUDSHIP_LOG_DIR || path.join(process.cwd(), 'data', 'logs'),
  cpuLimit: process.env.CLOUDSHIP_CPUS || '1.0',
  healthTimeoutMs: Number(process.env.CLOUDSHIP_HEALTH_TIMEOUT_MS || 60_000),
  healthIntervalMs: 1_000,
};