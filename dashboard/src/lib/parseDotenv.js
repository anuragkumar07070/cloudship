/**
 * Parse a .env file's text into an array of { key, value } pairs.
 * Order is preserved; later duplicates win.
 */
export function parseDotenv(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // allow `export KEY=VALUE`
    const withoutExport = line.startsWith('export ')
      ? line.slice('export '.length).trim()
      : line;

    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eq + 1).trim();

    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = unescapeDouble(value.slice(1, -1));
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      // strip trailing unquoted comment
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    out.push({ key, value });
  }
  return out;
}

function unescapeDouble(s) {
  return s.replace(/\\([nrt"\\])/g, (_, c) => {
    switch (c) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case '"': return '"';
      case '\\': return '\\';
      default: return c;
    }
  });
}