import express from 'express';
import { nanoid } from 'nanoid';
import { detect, deploy, teardown, newDeploymentId ,stopDeployment, startDeployment  } from '../pipeline/stages.js';
import {
  createDeployment, getDeployment, listDeployments, deleteDeployment, setStatus,
} from '../state/deployments.js';
import { parseEnvFile, envKeysOnly } from '../env/parseENV.js';
import { subscribe, readLogHistory } from '../logger.js';
import { config } from '../config.js';
import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 256 * 1024, files: 1 }, // 256 KB is plenty for a .env
});

export const router = express.Router();

router.post('/deployments', async (req, res) => {
  const { repoUrl, branch } = req.body || {};
  if (!repoUrl || typeof repoUrl !== 'string') {
    return res.status(400).json({ error: 'repoUrl is required' });
  }
  const id = newDeploymentId();
  try {
    createDeployment({ id, repoUrl, branch: branch || null });
    const manifest = await detect(id, repoUrl, branch || undefined);
    res.status(201).json({ id, manifest });
  } catch (err) {
    res.status(500).json({ id, error: err.message });
  }
});

router.get('/deployments', (_req, res) => {
  res.json(listDeployments());
});

router.get('/deployments/:id', (req, res) => {
  const d = getDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  res.json(d);
});

router.post('/deployments/:id/confirm', async (req, res) => {
  const d = getDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });

  // Validate what we can synchronously so bad input doesn't get a 202.
  const body = req.body || {};
  if (!body.compose) {
    const services = body.services || [];
    if (services.length === 0) {
      return res.status(400).json({ error: 'No services in manifest' });
    }
    for (const s of services) {
      if (!s.type || s.type === 'unknown') {
        return res.status(400).json({ error: `Service "${s.name}" has unknown type` });
      }
      if (s.type === 'node-server' && !s.port) {
        return res.status(400).json({ error: `Service "${s.name}" requires a port` });
      }
    }
  }

  // Kick off asynchronously. Failures are recorded on the deployment row
  // and streamed via SSE; there is no request to fail.
  deploy(req.params.id, body).catch(() => { /* status already set to failed */ });
  res.status(202).json({ ok: true, deploymentId: req.params.id });
});

router.post('/deployments/:id/stop', async (req, res) => {
  const d = getDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });

  // Async, same pattern as confirm.
  stopDeployment(req.params.id).catch(() => { /* status already set */ });
  res.status(202).json({ ok: true, deploymentId: req.params.id });
});

router.post('/deployments/:id/start', async (req, res) => {
  const d = getDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });

  startDeployment(req.params.id).catch(() => { /* status already set */ });
  res.status(202).json({ ok: true, deploymentId: req.params.id });
});

router.get('/config', (_req, res) => {
  res.json({
    baseDomain: config.baseDomain,
    scheme: config.scheme,
    concurrency: config.concurrency,
    proxyContainer: config.proxyContainer,
    proxyNetwork: config.proxyNetwork,
    workspaceRoot: config.workspaceRoot,
    memoryLimit: config.memoryLimit,
    cpuLimit: config.cpuLimit,
    healthTimeoutMs: config.healthTimeoutMs,
  });
});

router.get('/deployments/:id/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);
  const unsub = subscribe(req.params.id, send);
  const hb = setInterval(() => res.write(': hb\n\n'), 15_000);

  req.on('close', () => { clearInterval(hb); unsub(); });
});

router.delete('/deployments/:id', async (req, res) => {
  const d = getDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  try {
    await teardown(req.params.id);
    deleteDeployment(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Parse an uploaded .env file. Returns pairs, values are returned to the caller
// (the user typed them) but are NEVER written to the deployment log.
router.post('/deployments/:id/parse-env', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });

  let text;
  try { text = req.file.buffer.toString('utf8'); }
  catch { return res.status(400).json({ error: 'file must be UTF-8 text' }); }

  const keysOnly = req.query.keysOnly === '1' || req.query.keysOnly === 'true';
  const rows = keysOnly ? envKeysOnly(text).map((key) => ({ key, value: '' }))
    : parseEnvFile(text);

  res.json({ rows });
});

router.get('/deployments/:id/logs/history', (req, res) => {
  const d = getDeployment(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  res.json({ lines: readLogHistory(req.params.id) });
});