import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import NewDeployment from './views/NewDeployment.jsx';
import Confirm from './views/Confirm.jsx';
import Detail from './views/Detail.jsx';
import List from './views/List.jsx';

export default function App() {
  const [deploymentId, setDeploymentId] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [deployments, setDeployments] = useState([]);

  const refresh = async () => {
    try { setDeployments(await api('/deployments')); } catch {}
  };
  useEffect(() => { refresh(); }, []);

  const onCreated = (id, m) => { setDeploymentId(id); setManifest(m); refresh(); };
  const onConfirmed = () => { setManifest(null); refresh(); };
  const onDone = () => { setDeploymentId(null); setManifest(null); refresh(); };

  return (
    <div className="app">
      <header><h1>CloudShip</h1></header>
      <main>
        {!deploymentId && (
          <>
            <NewDeployment onCreated={onCreated} />
            <List deployments={deployments} onOpen={setDeploymentId} onDelete={async (id) => {
              await api(`/deployments/${id}`, { method: 'DELETE' }); refresh();
            }} />
          </>
        )}
        {deploymentId && manifest && (
          <Confirm
            deploymentId={deploymentId}
            manifest={manifest}
            onConfirmed={onConfirmed}
            onCancel={onDone}
          />
        )}
        {deploymentId && !manifest && (
          <Detail deploymentId={deploymentId} onBack={onDone} />
        )}
      </main>
    </div>
  );
}