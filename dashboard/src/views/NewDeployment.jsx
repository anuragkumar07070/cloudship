import React, { useState } from 'react';
import { api } from '../api.js';

export default function NewDeployment({ onCreated }) {
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const body = { repoUrl };
      if (branch.trim()) body.branch = branch.trim();
      const { id, manifest } = await api('/deployments', { method: 'POST', body });
      onCreated(id, manifest);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>New deployment</h2>
      <label>GitHub repository URL
        <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)}
               placeholder="https://github.com/user/repo" required />
      </label>
      <label>Branch (optional — defaults to the repo's default branch)
        <input value={branch} onChange={(e) => setBranch(e.target.value)}
               placeholder="main" />
      </label>
      <button disabled={busy}>{busy ? 'Scanning…' : 'Scan repository'}</button>
      {err && <p className="error">{err}</p>}
    </form>
  );
}