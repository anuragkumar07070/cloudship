import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { generateDockerfile, staticSiteNginxConf } from '../dockerfile-generator/templates.js';

function docker(args, { cwd, log }) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd });
    child.stdout.on('data', (d) => log(d.toString(), 'out'));
    child.stderr.on('data', (d) => log(d.toString(), 'err'));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`docker ${args.join(' ')} exited with code ${code}`)));
  });
}

/**
 * Build one service. Writes a generated Dockerfile into the workspace copy
 * when the service did not ship one.
 */
export async function buildService({ repoRoot, deploymentId, service, log }) {
  const serviceRoot = path.resolve(repoRoot, service.rootPath);
  const hasLockfile = fs.existsSync(path.join(serviceRoot, 'package-lock.json'));

  if (service.type !== 'dockerfile-provided') {
    const dockerfile = generateDockerfile(service, { hasLockfile });
    fs.writeFileSync(path.join(serviceRoot, 'Dockerfile'), dockerfile);
    if (service.type === 'static-site') {
      fs.writeFileSync(path.join(serviceRoot, '.cloudship-nginx.conf'), staticSiteNginxConf());
    }
    log(`Wrote generated Dockerfile for ${service.name}`);
  } else {
    log(`Using existing Dockerfile for ${service.name}`);
  }

  const imageTag = `cloudship-${deploymentId}-${service.name}:latest`;
  const buildArgs = [];
  for (const [k, v] of Object.entries(service.buildArgs || {})) {
    buildArgs.push('--build-arg', `${k}=${v}`);
  }
  log(`Building image ${imageTag}`);
  await docker(['build', ...buildArgs, '-t', imageTag, serviceRoot], { cwd: serviceRoot, log });
  return imageTag;
}