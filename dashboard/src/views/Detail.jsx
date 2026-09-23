import React, { useEffect, useRef, useState } from 'react';
import StatusPill from '../components/StatusPill.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import {
  api, streamLogs, getLogHistory, getDeployment,
  startDeployment, stopDeployment, deleteDeployment,
} from '../api.js';

export default function Detail({ deploymentId, onBack }) {
  const [d, setD] = useState(null);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(null);
  const [actionErr, setActionErr] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    let close = null;
    let interval = null;
    let cancelled = false;

    (async () => {
      try {
        const history = await getLogHistory(deploymentId);
        if (!cancelled && Array.isArray(history.lines)) {
          setLines((ls) => [...ls, ...history.lines].slice(-500));
        }
      } catch { /* ignore */ }

      try { setD(await getDeployment(deploymentId)); } catch { /* ignore */ }

      close = streamLogs(deploymentId, (line) => {
        setLines((ls) => [...ls.slice(-500), line]);
      });
      interval = setInterval(async () => {
        try { setD(await getDeployment(deploymentId)); } catch { /* ignore */ }
      }, 2_000);
    })();

    return () => { cancelled = true; close?.(); clearInterval(interval); };
  }, [deploymentId]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [lines]);

  const refresh = async () => {
    try { setD(await getDeployment(deploymentId)); } catch { /* ignore */ }
  };

  const doStart = async () => {
    setBusy('start'); setActionErr(null);
    try { await startDeployment(deploymentId); await refresh(); }
    catch (e) { setActionErr(`Start failed: ${e.message}`); }
    finally { setBusy(null); }
  };
  const doStop = async () => {
    setBusy('stop'); setActionErr(null);
    try { await stopDeployment(deploymentId); await refresh(); }
    catch (e) { setActionErr(`Stop failed: ${e.message}`); }
    finally { setBusy(null); }
  };
  const doDelete = async () => {
    setBusy('delete'); setActionErr(null);
    try { await deleteDeployment(deploymentId); onBack(); }
    catch (e) { setActionErr(`Delete failed: ${e.message}`); setBusy(null); }
  };

  const isRunning = d?.status === 'running';
  const isStopped = d?.status === 'stopped';
  const isTransitional = d && ['building', 'starting', 'stopping', 'health-check', 'cloning', 'scanning', 'awaiting-confirmation'].includes(d.status);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
          <h1 className="pageTitle">{d?.repoUrl || 'Deployment'}</h1>
          <div className="pageSub">
            <code>{deploymentId}</code>
            {d?.branch && <> · branch <code>{d.branch}</code></>}
          </div>
        </div>
        <div className="pageActions">
          {d && <StatusPill status={d.status} />}
          {isRunning && (
            <button type="button" className="btn btn-ghost" onClick={doStop} disabled={busy !== null}>
              {busy === 'stop' ? 'Stopping…' : 'Stop'}
            </button>
          )}
          {isStopped && (
            <button type="button" className="btn btn-primary" onClick={doStart} disabled={busy !== null}>
              {busy === 'start' ? 'Starting…' : 'Start'}
            </button>
          )}
          {isTransitional && (
            <button type="button" className="btn btn-ghost" disabled>Working…</button>
          )}
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirmDel(true)}
            disabled={busy !== null}
          >
            Delete
          </button>
        </div>
      </div>

      {actionErr && <div className="banner banner-error">{actionErr}</div>}
      {d?.error && <div className="banner banner-error">{d.error}</div>}

      {d?.urls?.length > 0 && (
        <section className="card">
          <h3 className="cardTitle">URLs</h3>
          <ul className="urlList">
            {d.urls.map((u) => {
              const host = u.replace(/^https?:\/\//, '');
              return (
                <li key={u}>
                  <a href={u} target="_blank" rel="noreferrer">{u}</a>
                  <div className="urlHint">add <code>127.0.0.1 {host}</code> to /etc/hosts if it doesn't resolve</div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {d?.services?.length > 0 && (
        <section className="card tableCard">
          <h3 className="cardTitle">Services</h3>
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Port</th><th>Container</th></tr>
            </thead>
            <tbody>
              {d.services.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.type}</td>
                  <td>{s.port ?? '—'}</td>
                  <td>{s.containerStatus ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card logs">
        <h3 className="cardTitle">Live log</h3>
        <pre ref={logRef}>{lines.join('\n')}</pre>
      </section>

      <ConfirmDialog
        open={confirmDel}
        title="Delete deployment?"
        body={`This will tear down containers, network, images, and proxy routes for ${deploymentId}. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={busy === 'delete'}
        onConfirm={doDelete}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}