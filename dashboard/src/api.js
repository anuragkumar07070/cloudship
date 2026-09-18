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