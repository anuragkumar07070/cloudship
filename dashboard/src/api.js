export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function streamLogs(id, onLine) {
  const es = new EventSource(`/api/deployments/${id}/logs`);
  es.onmessage = (e) => onLine(JSON.parse(e.data));
  return () => es.close();
}

// --- Deployments -----------------------------------------------------------

export const listDeployments = () => api('/deployments');
export const getDeployment  = (id) => api(`/deployments/${id}`);
export const deleteDeployment = (id) => api(`/deployments/${id}`, { method: 'DELETE' });
export const stopDeployment   = (id) => api(`/deployments/${id}/stop`,   { method: 'POST' });
export const startDeployment  = (id) => api(`/deployments/${id}/start`,  { method: 'POST' });
export const getLogHistory    = (id) => api(`/deployments/${id}/logs/history`);
export const getConfig        = ()   => api('/config');