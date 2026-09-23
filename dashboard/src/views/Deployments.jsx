import React, { useState } from 'react';
import StatusPill from '../components/StatusPill.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import {
  startDeployment, stopDeployment, deleteDeployment, getDeployment,
} from '../api.js';

const TRANSITIONAL = new Set(['building', 'starting', 'stopping', 'health-check', 'cloning', 'scanning', 'awaiting-confirmation']);

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch { return iso; }
}

function serviceCount(d) {
  // List endpoint doesn't include services; Detail does. Fall back to a
  // dash when we only have the summary.
  return d.serviceCount ?? '—';
}

export default function Deployments({
  deployments, loading, error, onRefresh, onOpen, onNewDeployment,
}) {
  const [busyId, setBusyId] = useState(null);
  const [actionErr, setActionErr] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const runAction = async (id, fn) => {
    setBusyId(id);
    setActionErr(null);
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      setActionErr(`Action failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleStart = (id) => runAction(id, () => startDeployment(id));
  const handleStop  = (id) => runAction(id, () => stopDeployment(id));

  const handleDeleteConfirmed = async () => {
    const id = confirmDel;
    setConfirmDel(null);
    await runAction(id, () => deleteDeployment(id));
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Deployments</h1>
          <div className="pageSub">
            {loading ? 'Loading…' : `${deployments.length} deployment${deployments.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <div className="pageActions">
          <button type="button" className="btn btn-ghost" onClick={onRefresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="btn btn-primary" onClick={onNewDeployment}>
            + New Deployment
          </button>
        </div>
      </div>

      {error && <div className="banner banner-error">Could not load deployments: {error}</div>}
      {actionErr && <div className="banner banner-error">{actionErr}</div>}

      <div className="card tableCard">
        <table className="table">
          <thead>
            <tr>
              <th>Repo</th>
              <th>Branch</th>
              <th>Status</th>
              <th>Services</th>
              <th>Created</th>
              <th className="colActions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {deployments.length === 0 && !loading && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    title="No deployments yet"
                    body="Deploy your first GitHub repository to see it here."
                    action={
                      <button type="button" className="btn btn-primary" onClick={onNewDeployment}>
                        + New Deployment
                      </button>
                    }
                  />
                </td>
              </tr>
            )}

            {deployments.map((d) => {
              const isBusy = busyId === d.id;
              const isTransitional = TRANSITIONAL.has(d.status);
              const isRunning = d.status === 'running';
              const isStopped = d.status === 'stopped';

              return (
                <tr key={d.id}>
                  <td>
                    <button type="button" className="linkButton" onClick={() => onOpen(d.id)}>
                      <div className="repoId">{d.id}</div>
                      <div className="repoUrl">{d.repoUrl}</div>
                    </button>
                  </td>
                  <td>{d.branch || '—'}</td>
                  <td><StatusPill status={d.status} /></td>
                  <td>{serviceCount(d)}</td>
                  <td>{formatDate(d.createdAt)}</td>
                  <td className="colActions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onOpen(d.id)}
                      disabled={isBusy}
                    >
                      View
                    </button>

                    {(isRunning || isStopped) && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => (isRunning ? handleStop(d.id) : handleStart(d.id))}
                        disabled={isBusy}
                      >
                        {isBusy ? 'Working…' : (isRunning ? 'Stop' : 'Start')}
                      </button>
                    )}

                    {isTransitional && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled>
                        Working…
                      </button>
                    )}

                    <button
                      type="button"
                      className="iconBtn iconBtn-danger"
                      onClick={() => setConfirmDel(d.id)}
                      disabled={isBusy}
                      title="Delete deployment"
                      aria-label="Delete deployment"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
                        strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                        <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete deployment?"
        body={`This will tear down containers, network, images, and proxy routes for ${confirmDel}. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={busyId === confirmDel}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}