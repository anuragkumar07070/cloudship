import React, { useState } from 'react';
import { api } from '../api.js';
import EnvUploader from '../components/EnvUploader.jsx';
import EnvPasteBox from '../components/EnvPasteBox.jsx';

const TYPES = ['static-site', 'node-server', 'unknown', 'dockerfile-provided'];

function blankEnv() { return { serviceName: '', key: '', value: '' }; }

function mergeEnvRows(existing, incoming, serviceName = '') {
  const keyOf = (r) => `${r.serviceName ?? ''}\u0000${r.key}`;
  const map = new Map();
  const isUsable = (r) =>
    r && typeof r.key === 'string' && r.key.trim() !== '' &&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(r.key.trim());

  for (const r of existing) if (isUsable(r)) map.set(keyOf(r), { ...r, key: r.key.trim() });
  for (const r of incoming) {
    if (!isUsable(r)) continue;
    const row = { serviceName, key: r.key.trim(), value: r.value ?? '' };
    map.set(keyOf(row), row);
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
    setServices((all) => all.map((s, idx) => (idx === i ? { ...s, ...changes } : s)));

  const validation = () => {
    for (const s of services) {
      if (!s.type || s.type === 'unknown') return `Service "${s.name}": choose a type.`;
      if (s.type === 'node-server' && !s.port) return `Service "${s.name}": a port is required.`;
    }
    for (const row of envVars) {
      if (row.key && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.key)) {
        return `Invalid env var key: "${row.key}"`;
      }
    }
    return null;
  };

  const handleUpload = (rows, { serviceName }) => {
    setEnvVars((existing) => mergeEnvRows(existing, rows, serviceName));
  };
  const handlePaste = (rows, { serviceName }) => {
    setEnvVars((existing) => mergeEnvRows(existing, rows, serviceName));
  };

  const submit = async () => {
    const v = validation();
    if (v) { setErr(v); return; }
    setBusy(true); setErr(null);
    try {
      const cleanEnvVars = envVars.filter(
        (r) => r.key && /^[A-Za-z_][A-Za-z0-9_]*$/.test(r.key),
      );
      await api(`/deployments/${deploymentId}/confirm`, {
        method: 'POST',
        body: {
          compose: !!manifest.compose,
          composeFile: manifest.composeFile,
          services,
          envVars: cleanEnvVars,
          frontendApiEnvVar: showCross ? frontendApiEnvVar : undefined,
          backendCorsEnvVar: showCross ? backendCorsEnvVar : undefined,
        },
      });
      onConfirmed();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="pageHeader">
      <div>
        <h1 className="pageTitle">Confirm Deployment</h1>
        <div className="pageSub">
          {manifest.compose
            ? <>Compose file detected: <code>{manifest.composeFile}</code></>
            : 'Review the detected services before deploying.'}
        </div>
      </div>
      <div className="pageActions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Deploying…' : 'Confirm and deploy'}
        </button>
      </div>
    </div>
  );

  const envSection = (
    <section className="card">
      <h3 className="cardTitle">Environment variables</h3>
      <div className="row gap wrap">
        <EnvUploader serviceOptions={services.map((s) => s.name)} onParsed={handleUpload} />
        <EnvPasteBox serviceOptions={services.map((s) => s.name)} onParsed={handlePaste} />
      </div>
      <EnvEditor
        envVars={envVars}
        setEnvVars={setEnvVars}
        serviceOptions={services.map((s) => s.name)}
      />
    </section>
  );

  if (manifest.compose) {
    return (
      <div className="page">
        {header}
        <div className="banner banner-info">
          This repository declares its own <code>{manifest.composeFile}</code>.
          CloudShip will run <code>docker compose up</code> after you provide env vars.
        </div>
        {envSection}
        {err && <div className="banner banner-error">{err}</div>}
      </div>
    );
  }

  return (
    <div className="page">
      {header}

      {services.map((s, i) => (
        <section className="card" key={i}>
          <h3 className="cardTitle">{s.name} <span className="muted">({s.rootPath})</span></h3>
          {s.warnings?.length > 0 && (
            <div className="banner banner-warn">{s.warnings.join(' ')}</div>
          )}
          <div className="grid2">
            <label className="field">
              <span className="fieldLabel">Name</span>
              <input value={s.name} onChange={(e) => patch(i, { name: e.target.value })} />
            </label>
            <label className="field">
              <span className="fieldLabel">Root path</span>
              <input value={s.rootPath} onChange={(e) => patch(i, { rootPath: e.target.value })} />
            </label>
            <label className="field">
              <span className="fieldLabel">Type</span>
              <select value={s.type} onChange={(e) => patch(i, { type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="fieldLabel">Port</span>
              <input
                type="number"
                value={s.port ?? ''}
                onChange={(e) => patch(i, { port: e.target.value ? Number(e.target.value) : null })}
              />
            </label>
            <label className="field">
              <span className="fieldLabel">Build command</span>
              <input value={s.buildCommand || ''} onChange={(e) => patch(i, { buildCommand: e.target.value })} />
            </label>
            <label className="field">
              <span className="fieldLabel">Start command</span>
              <input value={s.startCommand || ''} onChange={(e) => patch(i, { startCommand: e.target.value })} />
            </label>
            <label className="field">
              <span className="fieldLabel">Output directory</span>
              <input value={s.outputDir || ''} onChange={(e) => patch(i, { outputDir: e.target.value })} />
            </label>
            <label className="field checkbox">
              <input
                type="checkbox"
                checked={!!s.isPublic}
                onChange={(e) => patch(i, { isPublic: e.target.checked })}
              />
              <span>Publicly exposed</span>
            </label>
          </div>
        </section>
      ))}

      {showCross && (
        <section className="card">
          <h3 className="cardTitle">Cross-service wiring</h3>
          <div className="grid2">
            <label className="field">
              <span className="fieldLabel">Frontend env var for backend URL (build-time)</span>
              <input value={frontendApiEnvVar} onChange={(e) => setFrontendApiEnvVar(e.target.value)} />
            </label>
            <label className="field">
              <span className="fieldLabel">Backend env var for frontend URL (runtime)</span>
              <input value={backendCorsEnvVar} onChange={(e) => setBackendCorsEnvVar(e.target.value)} />
            </label>
          </div>
        </section>
      )}

      {envSection}
      {err && <div className="banner banner-error">{err}</div>}
    </div>
  );
}

function EnvEditor({ envVars, setEnvVars, serviceOptions = [] }) {
  const add = () => setEnvVars([...envVars, blankEnv()]);
  const patch = (i, c) => setEnvVars(envVars.map((r, idx) => (idx === i ? { ...r, ...c } : r)));
  const del = (i) => setEnvVars(envVars.filter((_, idx) => idx !== i));
  const isValidKey = (k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k || '');

  return (
    <div className="envEditor">
      {envVars.map((r, i) => {
        const badKey = r.key && !isValidKey(r.key);
        return (
          <div className="envRow" key={i}>
            <select value={r.serviceName} onChange={(e) => patch(i, { serviceName: e.target.value })}>
              <option value="">all services</option>
              {serviceOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <input
              placeholder="KEY"
              value={r.key}
              onChange={(e) => patch(i, { key: e.target.value })}
              className={badKey ? 'input-error' : undefined}
              title={badKey ? 'Invalid env var name' : undefined}
            />
            <input placeholder="value" value={r.value} onChange={(e) => patch(i, { value: e.target.value })} />
            <button type="button" className="iconBtn iconBtn-danger" onClick={() => del(i)} aria-label="Remove">×</button>
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost btn-sm" onClick={add}>+ Add variable</button>
    </div>
  );
}