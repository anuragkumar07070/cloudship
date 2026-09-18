/**
 * Build a redactor from a list of {key, value} env vars.
 * Any occurrence of a secret value in log text is replaced with ***.
 */
export function makeRedactor(envVars = []) {
  const secrets = envVars
    .map((e) => (e && e.value ? String(e.value) : ''))
    .filter((v) => v.length >= 4);
  if (secrets.length === 0) return (s) => s;
  return (s) => {
    let out = s;
    for (const v of secrets) {
      out = out.split(v).join('***');
    }
    return out;
  };
}