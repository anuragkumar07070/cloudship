// src/logger.js
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const subscribers = new Map(); // deploymentId -> Set<fn>

function logFilePath(deploymentId) {
  const dir = config.logDir;
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${deploymentId}.log`);
}

export function subscribe(deploymentId, fn) {
  if (!subscribers.has(deploymentId)) subscribers.set(deploymentId, new Set());
  subscribers.get(deploymentId).add(fn);
  return () => subscribers.get(deploymentId)?.delete(fn);
}

export function emit(deploymentId, line) {
  const set = subscribers.get(deploymentId);
  if (set) {
    for (const fn of set) {
      try { fn(line); } catch { /* ignore */ }
    }
  }
}

export function makeLogger(deploymentId, redactor = (s) => s) {
  const file = logFilePath(deploymentId);
  return (msg, stream = 'out') => {
    const ts = new Date().toISOString();
    const safe = redactor(String(msg));
    const line = `[${ts}] [${stream}] ${safe}`;
    try { fs.appendFileSync(file, line + '\n'); } catch { /* best-effort */ }
    emit(deploymentId, line);
  };
}

export function readLogHistory(deploymentId, { maxLines = 2000 } = {}) {
  const file = logFilePath(deploymentId);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  const all = raw.split('\n').filter(Boolean);
  return all.slice(-maxLines);
}