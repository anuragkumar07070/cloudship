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
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">New Deployment</h1>
          <div className="pageSub">Point CloudShip at a public GitHub repository.</div>
        </div>
      </div>

      <form className="card formCard" onSubmit={submit}>
        <label className="field">
          <span className="fieldLabel">GitHub repository URL</span>
          <input
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/user/repo"
            required
          />
        </label>

        <label className="field">
          <span className="fieldLabel">Branch (optional)</span>
          <input
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="Leave blank for the repo's default branch"
          />
        </label>

        <div className="formActions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Scanning…' : 'Scan repository'}
          </button>
        </div>

        {err && <div className="banner banner-error">{err}</div>}
      </form>
    </div>
  );
}