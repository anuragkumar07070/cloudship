// src/git/clone.js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export function workspacePath(deploymentId) {
  return path.join(config.workspaceRoot, deploymentId);
}

function run(cmd, args, { cwd, log } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    child.stdout.on('data', (d) => log && log(d.toString(), 'out'));
    child.stderr.on('data', (d) => log && log(d.toString(), 'err'));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`)));
  });
}

export async function cloneRepo({ deploymentId, repoUrl, branch, log }) {
  const ws = workspacePath(deploymentId);
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });

  const args = ['clone', '--depth', '1'];
  if (branch) {
    args.push('--branch', branch);
    log(`Cloning ${repoUrl} @ ${branch} into ${ws}`);
  } else {
    log(`Cloning ${repoUrl} (default branch) into ${ws}`);
  }
  args.push(repoUrl, ws);

  await run('git', args, { log });
  return ws;
}