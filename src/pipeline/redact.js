const NON_SECRET_KEYS = new Set([
  'NODE_ENV', 'PORT', 'HOST', 'HOSTNAME', 'NODE_PORT',
  'VITE_API_URL', 'VITE_SOCKET_URL', 'VITE_BACKEND_URL',
  'REACT_APP_API_URL', 'REACT_APP_SOCKET_URL',
  'FRONTEND_URL', 'CLIENT_URL', 'CORS_ORIGIN', 'CORS_ORIGINS',
  'JWT_EXPIRE', 'LOG_LEVEL', 'TZ',
]);

/**
 * Build a redactor from a list of {key, value} env vars.
 * Any occurrence of a secret value in log text is replaced with ***.
 * Values for non-secret keys (port numbers, URLs, etc.) are NOT masked,
 * so the log remains diagnosable.
 */
export function makeRedactor(envVars = []) {
  const secrets = envVars
    .filter((e) => e && e.key && !NON_SECRET_KEYS.has(e.key))
    .map((e) => (e.value ? String(e.value) : ''))
    .filter((v) => v.length >= 4);
  if (secrets.length === 0) return (s) => s;
  return (s) => {
    let out = s;
    for (const v of secrets) out = out.split(v).join('***');
    return out;
  };
}``