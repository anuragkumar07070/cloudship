import React from 'react';

export default function List({ deployments, onOpen, onDelete }) {
  if (deployments.length === 0) return null;
  return (
    <div className="card">
      <h2>Deployments</h2>
      <table>
        <thead><tr><th>ID</th><th>Repo</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {deployments.map((d) => (
            <tr key={d.id}>
              <td><code>{d.id}</code></td>
              <td>{d.repoUrl}</td>
              <td>{d.status}</td>
              <td>
                <button onClick={() => onOpen(d.id)}>Open</button>
                <button className="ghost" onClick={() => onDelete(d.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}