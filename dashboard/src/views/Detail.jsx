import React, { useEffect, useRef, useState } from 'react';
import { api, streamLogs } from '../api.js';

export default function Detail({ deploymentId, onBack }) {
  const [d, setD] = useState(null);
  const [lines, setLines] = useState([]);
  const logRef = useRef(null);

  useEffect(() => {
    let close = null;
    let interval = null;
    let cancelled = false;
    (async () => {
      try {
        const history = await api(`/deployments/${deploymentId}/logs/history`);
        if (!cancelled && Array.isArray(history.lines)) {
          setLines((ls) => [...ls, ...history.lines].slice(-500));
        }
      } catch {}

      try { setD(await api(`/deployments/${deploymentId}`)); } catch {}

      close = streamLogs(deploymentId, (line) => {
        setLines((ls) => [...ls.slice(-500), line]);
      });
      interval = setInterval(async () => {
        try { setD(await api(`/deployments/${deploymentId}`)); } catch {}
      }, 2_000);
    })();
    return () => { cancelled = true; close?.(); clearInterval(interval); };
  }, [deploymentId]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [lines]);

  return (
    <div>
      <button className="ghost" onClick={onBack}>← Back</button>
      {d && (
        <div className="card">
          <h2>{d.repoUrl}</h2>
          <p>Status: <strong>{d.status}</strong></p>
          {d.error && <p className="error">{d.error}</p>}

          {d.urls?.length > 0 ? (
            <>
              <h3>URLs</h3>
              <ul>
                {d.urls.map((u) => {
                  const clickable = u.replace(/^https:\/\//, 'http://');
                  const host = clickable.replace(/^http:\/\//, '');
                  return (
                    <li key={u}>
                      <a href={clickable} target="_blank" rel="noreferrer">{clickable}</a>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                        add <code>127.0.0.1 {host}</code> to /etc/hosts if it doesn't resolve
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="warn">No URLs — the service may not have been marked publicly exposed.</p>
          )}

          {d.services?.length > 0 && (
            <table>
              <thead>
                <tr><th>Service</th><th>Type</th><th>Port</th><th>Status</th></tr>
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
          )}
        </div>
      )}
      <div className="card logs">
        <h3>Live log</h3>
        <pre ref={logRef}>{lines.join('\n')}</pre>
      </div>
    </div>
  );
}