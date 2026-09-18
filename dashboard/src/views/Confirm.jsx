import React, { useState } from 'react';
import { api } from '../api.js';
import EnvUploader from '../components/EnvUploader.jsx';

const TYPES = ['static-site', 'node-server', 'unknown', 'dockerfile-provided'];

function blankEnv() { return { serviceName: '', key: '', value: '' }; }

/**
 * Merge rows into an existing envVars list. Later rows win when
 * (serviceName, key) collides.
 */
function mergeEnvRows(existing, incoming, serviceName = '') {
  const key = (r) => `${r.serviceName ?? ''}\u0000${r.key}`;
  const map = new Map();
  for (const r of existing) map.set(key(r), r);
  for (const r of incoming) {
    const row = { serviceName, key: r.key, value: r.value };
    map.set(key(row), row);
  }
  return [...map.values()];
}

export default function Confirm({ deploymentId, manifest, onConfirmed, onCancel }) {
  const [services, setServices] = useState(manifest.services || []);
  const [envVars, setEnvVars] = useState([]);
  const [frontendApiEnvVar, setFrontendApiEnvVar] = useState('VITE_API_URL');
  const [backendCorsEnvVar, setBackendCorsEnvVar] = useState('FRONTEND_URL');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const hasStatic = services.some((s) => s.type === 'static-site');
  const hasNode = services.some((s) => s.type === 'node-server');
  const showCross = hasStatic && hasNode;

  const patch = (i, changes) =>
    setServices((all) => all.map((s, idx) => idx === i ? { ...s, ...changes } : s));

  const validation = () => {
    for (const s of services) {
      if (!s.type || s.type === 'unknown') return `Service "${s.name}": choose a type.`;
      if (s.type === 'node-server' && !s.port) return `Service "${s.name}": a port is required.`;
    }
    return null;
  };

  const handleUpload = (rows, { serviceName }) => {
    setEnvVars((existing) => mergeEnvRows(existing, rows, serviceName));
  };

  const submit = async () => {
    const v = validation();
    if (v) { setErr(v); return; }
    setBusy(true); setErr(null);
    try {
      const payload = {
        compose: !!manifest.compose,
        composeFile: manifest.composeFile,
        services,
        envVars,
        frontendApiEnvVar: showCross ? frontendApiEnvVar : undefined,
        backendCorsEnvVar: showCross ? backendCorsEnvVar : undefined,
      };
      await api(`/deployments/${deploymentId}/confirm`, { method: 'POST', body: payload });
      onConfirmed();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (manifest.compose) {
    return (
      <div className="card">
        <h2>Compose deployment confirmed</h2>
        <p>This repository declares its own <code>{manifest.composeFile}</code>.
          Provide environment variables only.</p>

        <EnvUploader serviceOptions={[]} onParsed={handleUpload} />
        <EnvEditor envVars={envVars} setEnvVars={setEnvVars} serviceOptions={[]} />

        <button onClick={submit} disabled={busy}>{busy ? 'Deploying…' : 'Deploy'}</button>
        {err && <p className="error">{err}</p>}
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  return (
    <div>
      <h2>Confirm detected services</h2>
      {services.map((s, i) => (
        <div className="card service" key={i}>
          <h3>{s.name} <small>({s.rootPath})</small></h3>
          {s.warnings?.length > 0 && (
            <p className="warn">{s.warnings.join(' ')}</p>
          )}
          <div className="grid">
            <label>Name<input value={s.name} onChange={(e) => patch(i, { name: e.target.value })} /></label>
            <label>Root path<input value={s.rootPath} onChange={(e) => patch(i, { rootPath: e.target.value })} /></label>
            <label>Type
              <select value={s.type} onChange={(e) => patch(i, { type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>Build command<input value={s.buildCommand || ''} onChange={(e) => patch(i, { buildCommand: e.target.value })} /></label>
            <label>Start command<input value={s.startCommand || ''} onChange={(e) => patch(i, { startCommand: e.target.value })} /></label>
            <label>Output directory<input value={s.outputDir || ''} onChange={(e) => patch(i, { outputDir: e.target.value })} /></label>
            <label>Port<input type="number" value={s.port ?? ''} onChange={(e) => patch(i, { port: e.target.value ? Number(e.target.value) : null })} /></label>
            <label className="checkbox">
              <input type="checkbox" checked={!!s.isPublic} onChange={(e) => patch(i, { isPublic: e.target.checked })} />
              Publicly exposed
            </label>
          </div>
        </div>
      ))}

      {showCross && (
        <div className="card">
          <h3>Cross-service wiring</h3>
          <label>Frontend env var for backend URL (build-time)
            <input value={frontendApiEnvVar} onChange={(e) => setFrontendApiEnvVar(e.target.value)} />
          </label>
          <label>Backend env var for frontend URL (runtime)
            <input value={backendCorsEnvVar} onChange={(e) => setBackendCorsEnvVar(e.target.value)} />
          </label>
        </div>
      )}

      <div className="card">
        <h3>Environment variables</h3>
        <EnvUploader
          serviceOptions={services.map((s) => s.name)}
          onParsed={handleUpload}
        />
        <EnvEditor
          envVars={envVars}
          setEnvVars={setEnvVars}
          serviceOptions={services.map((s) => s.name)}
        />
      </div>

      <button onClick={submit} disabled={busy}>{busy ? 'Deploying…' : 'Confirm and deploy'}</button>
      <button className="ghost" onClick={onCancel}>Cancel</button>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

function EnvEditor({ envVars, setEnvVars, serviceOptions = [] }) {
  const add = () => setEnvVars([...envVars, blankEnv()]);
  const patch = (i, c) => setEnvVars(envVars.map((r, idx) => idx === i ? { ...r, ...c } : r));
  const del = (i) => setEnvVars(envVars.filter((_, idx) => idx !== i));
  return (
    <div>
      {envVars.map((r, i) => (
        <div className="envRow" key={i}>
          <select value={r.serviceName} onChange={(e) => patch(i, { serviceName: e.target.value })}>
            <option value="">all services</option>
            {serviceOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <input placeholder="KEY" value={r.key} onChange={(e) => patch(i, { key: e.target.value })} />
          <input placeholder="value" value={r.value} onChange={(e) => patch(i, { value: e.target.value })} />
          <button type="button" className="ghost" onClick={() => del(i)}>×</button>
        </div>
      ))}
      <button type="button" onClick={add}>+ Add variable</button>
    </div>
  );
}