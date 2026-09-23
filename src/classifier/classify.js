import fs from 'node:fs';
import path from 'node:path';

const BUNDLERS = ['vite', 'react-scripts'];
const UI_FRAMEWORKS = ['react', 'react-dom', 'vue'];
const SERVER_FRAMEWORKS = ['express', 'fastify', 'koa', '@nestjs/core'];

/**
 * Single source of truth for "does this service name look like a frontend?"
 * Used by:
 *   - deployCompose() to decide same-origin routing (willUseCombined)
 *   - writeFrontendEnvFiles() to decide where to write .env.production
 * Keeping this in one place ensures both decisions always agree.
 */
export function isFrontendServiceName(name) {
  if (typeof name !== 'string') return false;
  return /frontend|web|client|app|ui/i.test(name);
}

/**
 * Single source of truth for "does this service name look like a backend?"
 * Used by deployCompose() to identify the pairing counterpart.
 */
export function isBackendServiceName(name) {
  if (typeof name !== 'string') return false;
  return /backend|api|server/i.test(name);
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function detectExpose(dockerfileText) {
  const m = dockerfileText.match(/^\s*EXPOSE\s+(\d+)/im);
  return m ? Number(m[1]) : null;
}

export function classifyService(repoRoot, relPath) {
  const abs = path.join(repoRoot, relPath);
  const pkg = readJson(path.join(abs, 'package.json')) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const has = (name) => Object.prototype.hasOwnProperty.call(deps, name);

  const hasDockerfile = fs.existsSync(path.join(abs, 'Dockerfile'));
  const dockerfileText = hasDockerfile ? fs.readFileSync(path.join(abs, 'Dockerfile'), 'utf8') : '';

  let type;
  if (hasDockerfile) type = 'dockerfile-provided';
  else if (BUNDLERS.some(has) && UI_FRAMEWORKS.some(has)) type = 'static-site';
  else if (SERVER_FRAMEWORKS.some(has)) type = 'node-server';
  else type = 'unknown';

  const service = {
    name: defaultName(relPath),
    rootPath: relPath,
    type,
    buildCommand: '',
    startCommand: '',
    outputDir: '',
    port: null,
    isPublic: false,
    envVars: [],
    warnings: [],
  };

  if (type === 'static-site') {
    service.buildCommand = 'npm run build';
    service.port = 80;
    if (has('vite')) service.outputDir = 'dist';
    else if (has('react-scripts')) service.outputDir = 'build';
    else service.outputDir = 'dist';
  } else if (type === 'node-server') {
    service.startCommand = pkg.scripts?.start || '';
    const exposed = dockerfileText ? detectExpose(dockerfileText) : null;
    service.port = exposed ?? null;
  } else if (type === 'dockerfile-provided') {
    service.port = detectExpose(dockerfileText) ?? null;
  }

  const vercelPath = path.join(repoRoot, 'vercel.json');
  if (fs.existsSync(vercelPath)) {
    let vercel = null;
    try { vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8')); } catch {}
    const hasRewrites = vercel && Array.isArray(vercel.rewrites) && vercel.rewrites.length > 0;
    const hasApiDir = fs.existsSync(path.join(repoRoot, 'api'));
    if (hasRewrites && hasApiDir) {
      service.warnings.push(
        'This repo uses Vercel serverless functions, which will not be deployed.');
    }
  }

  return service;
}

function defaultName(relPath) {
  if (relPath === '.' || relPath === '') return 'app';
  return relPath.replace(/[\\/]/g, '-').replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase();
}