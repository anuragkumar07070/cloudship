import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import Deployments from './views/Deployments.jsx';
import NewDeployment from './views/NewDeployment.jsx';
import Confirm from './views/Confirm.jsx';
import Detail from './views/Detail.jsx';
import Settings from './views/Settings.jsx';
import { listDeployments } from './api.js';

export default function App() {
  // Views: 'deployments' | 'new' | 'settings'
  const [view, setView] = useState('deployments');

  // Flow state carried across views during a fresh deployment.
  const [pendingId, setPendingId] = useState(null);
  const [pendingManifest, setPendingManifest] = useState(null);

  // Detail target when the user opens an existing deployment.
  const [openId, setOpenId] = useState(null);

  // Deployments list + loading/error
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState(null);

  // Free-text search bound to the TopBar input.
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const data = await listDeployments();
      setDeployments(Array.isArray(data) ? data : []);
    } catch (e) {
      setLoadErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Called after POST /deployments returns { id, manifest }.
  const onCreated = (id, manifest) => {
    setPendingId(id);
    setPendingManifest(manifest);
    setView('new');
    refresh();
  };

  // Called after the confirm step's POST returns 202.
  const onConfirmed = () => {
    const id = pendingId;
    setPendingManifest(null);
    setOpenId(id);       // jump straight into the live view
    refresh();
  };

  const onFlowCancel = () => {
    setPendingId(null);
    setPendingManifest(null);
    setView('deployments');
    refresh();
  };

  const onOpenExisting = (id) => {
    setOpenId(id);
    setPendingId(null);
    setPendingManifest(null);
  };

  const onCloseDetail = () => {
    setOpenId(null);
    refresh();
  };

  const onSettings = () => {
    setView('settings');
    setOpenId(null);
  };

  const onDeployments = () => {
    setView('deployments');
    setOpenId(null);
    refresh();
  };

  const onNewDeployment = () => {
    setView('new');
    setOpenId(null);
    setPendingId(null);
    setPendingManifest(null);
  };

  // Which nav item is "active" in the sidebar.
  const active =
    openId ? 'deployments'
    : view === 'settings' ? 'settings'
    : view === 'new' ? 'new'
    : 'deployments';

  // Filter deployments client-side for the table.
  const filtered = deployments.filter((d) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      String(d.id || '').toLowerCase().includes(q) ||
      String(d.repoUrl || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="appShell">
      <Sidebar
        active={active}
        onDeployments={onDeployments}
        onNewDeployment={onNewDeployment}
        onSettings={onSettings}
      />
      <div className="appMain">
        <TopBar query={query} onQueryChange={setQuery} />
        <main className="pageBody">
          {openId && (
            <Detail
              deploymentId={openId}
              onBack={onCloseDetail}
            />
          )}

          {!openId && view === 'deployments' && (
            <Deployments
              deployments={filtered}
              loading={loading}
              error={loadErr}
              onRefresh={refresh}
              onOpen={onOpenExisting}
              onNewDeployment={onNewDeployment}
            />
          )}

          {!openId && view === 'new' && pendingId && pendingManifest && (
            <Confirm
              deploymentId={pendingId}
              manifest={pendingManifest}
              onConfirmed={onConfirmed}
              onCancel={onFlowCancel}
            />
          )}

          {!openId && view === 'new' && !pendingId && (
            <NewDeployment onCreated={onCreated} />
          )}

          {!openId && view === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}