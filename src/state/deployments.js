import { db } from './db.js';

export function createDeployment({ id, repoUrl, branch }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO deployments (id, repoUrl, branch, status, urls, createdAt, updatedAt)
              VALUES (?, ?, ?, 'cloning', '[]', ?, ?)`)
    .run(id, repoUrl, branch ?? null, now, now);
}

export function setStatus(id, status, error = null) {
  db.prepare(`UPDATE deployments SET status=?, error=?, updatedAt=? WHERE id=?`)
    .run(status, error, new Date().toISOString(), id);
}

export function setUrls(id, urls) {
  db.prepare(`UPDATE deployments SET urls=?, updatedAt=? WHERE id=?`)
    .run(JSON.stringify(urls), new Date().toISOString(), id);
}

export function setManifest(id, manifest, composePath = false) {
  db.prepare(`UPDATE deployments SET manifest=?, composePath=?, updatedAt=? WHERE id=?`)
    .run(JSON.stringify(manifest), composePath ? 1 : 0, new Date().toISOString(), id);
}

export function saveEnvVars(id, envVars) {
  const tx = db.transaction((rows) => {
    db.prepare(`DELETE FROM env_vars WHERE deploymentId=?`).run(id);
    const ins = db.prepare(`INSERT INTO env_vars (deploymentId, serviceName, key, value) VALUES (?,?,?,?)`);
    for (const r of rows) ins.run(id, r.serviceName ?? null, r.key, r.value);
  });
  tx(envVars);
}

export function getEnvVars(id) {
  return db.prepare(`SELECT serviceName, key, value FROM env_vars WHERE deploymentId=?`).all(id);
}

export function replaceServices(id, services) {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM services WHERE deploymentId=?`).run(id);
    const ins = db.prepare(`INSERT INTO services
      (deploymentId, name, rootPath, type, port, isPublic)
      VALUES (?,?,?,?,?,?)`);
    for (const s of services) {
      ins.run(id, s.name, s.rootPath, s.type, s.port ?? null, s.isPublic ? 1 : 0);
    }
  });
  tx();
}

export function updateServiceContainer(id, name, { containerId, containerStatus }) {
  db.prepare(`UPDATE services SET containerId=?, containerStatus=? WHERE deploymentId=? AND name=?`)
    .run(containerId, containerStatus, id, name);
}

export function getDeployment(id) {
  const d = db.prepare(`SELECT * FROM deployments WHERE id=?`).get(id);
  if (!d) return null;
  const services = db.prepare(`SELECT * FROM services WHERE deploymentId=?`).all(id);
  return {
    ...d,
    urls: JSON.parse(d.urls || '[]'),
    manifest: d.manifest ? JSON.parse(d.manifest) : null,
    composePath: !!d.composePath,
    services,
  };
}

export function listDeployments() {
  return db.prepare(`SELECT * FROM deployments ORDER BY createdAt DESC`).all()
    .map((d) => ({ ...d, urls: JSON.parse(d.urls || '[]'), composePath: !!d.composePath,
                   manifest: d.manifest ? JSON.parse(d.manifest) : null }));
}

export function deleteDeployment(id) {
  db.prepare(`DELETE FROM services WHERE deploymentId=?`).run(id);
  db.prepare(`DELETE FROM env_vars WHERE deploymentId=?`).run(id);
  db.prepare(`DELETE FROM deployments WHERE id=?`).run(id);
}