import React, { useEffect, useState } from 'react';
import { getConfig } from '../api.js';

export default function Settings() {
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    getConfig().then(setCfg).catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Settings</h1>
          <div className="pageSub">Read-only view of the running CloudShip configuration.</div>
        </div>
      </div>

      {err && <div className="banner banner-error">{err}</div>}

      {cfg && (
        <section className="card">
          <h3 className="cardTitle">Runtime config</h3>
          <table className="table table-narrow">
            <tbody>
              {Object.entries(cfg).map(([k, v]) => (
                <tr key={k}>
                  <td className="cfgKey"><code>{k}</code></td>
                  <td className="cfgVal">{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}