import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { router } from './api/routes.js';
import { ensureProxy } from './proxy/proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api', router);

const dashboardDist = path.resolve(__dirname, '..', 'dashboard', 'dist');
if (fs.existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.get('*', (_req, res) => res.sendFile(path.join(dashboardDist, 'index.html')));
}

app.listen(config.port, async () => {
  console.log(`CloudShip backend listening on :${config.port}`);
  try {
    await ensureProxy();
    console.log('[proxy] ready');
  } catch (e) {
    console.warn(`[proxy] startup check failed: ${e.message}`);
  }
});