/**
 * Parse a .env file body into { key, value } pairs.
 *
 * Supported syntax (dotenv-compatible subset):
 *   KEY=value
 *   KEY="value with spaces"
 *   KEY='value'
 *   export KEY=value
 *   # comments and blank lines ignored
 *
 * Values are NOT interpolated and NOT expanded — what you wrote is what you get.
 */
export function parseEnvFile(text) {
  const rows = [];
  const lines = String(text).split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // strip leading `export `
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line;

    const eq = body.indexOf('=');
    if (eq === -1) continue;

    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = body.slice(eq + 1).trim();

    // strip matching surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
      // unescape \" and \\ inside double quotes
      if (raw.includes('"')) {
        value = value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    } else {
      // unquoted: strip trailing inline comment ( ... # comment)
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trimEnd();
    }

    rows.push({ key, value });
  }

  return rows;
}

/** Extract just the keys (for importing .env.example safely). */
export function envKeysOnly(text) {
  return parseEnvFile(text).map((r) => r.key);
}