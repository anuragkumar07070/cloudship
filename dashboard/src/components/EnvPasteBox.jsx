import React, { useState } from 'react';
import { parseDotenv } from '../lib/parseDotenv.js';

/**
 * Parse raw .env text, filter invalid rows, and report what was found.
 * Reuses the same parser as the Upload button so behavior is identical.
 */
function sanitizeRows(text) {
  const parsed = parseDotenv(text);

  const valid = [];
  const dropped = [];

  for (const row of parsed) {
    const key = typeof row.key === 'string' ? row.key.trim() : '';
    if (!key) {
      dropped.push('(empty key)');
      continue;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      dropped.push(key);
      continue;
    }
    valid.push({ key, value: typeof row.value === 'string' ? row.value : '' });
  }

  return { valid, dropped };
}

export default function EnvPasteBox({ serviceOptions = [], onParsed }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [scope, setScope] = useState('');
  const [msg, setMsg] = useState(null);
  const [warn, setWarn] = useState(null);
  const [err, setErr] = useState(null);

  const reset = () => {
    setMsg(null);
    setWarn(null);
    setErr(null);
  };

  const handleImport = () => {
    reset();
    if (!text.trim()) {
      setErr('Nothing to import — paste a .env first.');
      return;
    }

    const { valid, dropped } = sanitizeRows(text);

    if (valid.length === 0) {
      setErr('No valid KEY=VALUE pairs found in the pasted text.');
      return;
    }

    onParsed(valid, { serviceName: scope, fileName: '(pasted)' });

    setMsg(
      `Imported ${valid.length} variable${valid.length === 1 ? '' : 's'}.`,
    );
    if (dropped.length > 0) {
      setWarn(
        `Skipped ${dropped.length} invalid line${dropped.length === 1 ? '' : 's'}: ${dropped
          .slice(0, 3)
          .join(', ')}${dropped.length > 3 ? ', …' : ''}`,
      );
    }

    setText('');
  };

  const handleCancel = () => {
    reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="ghost"
        onClick={() => setOpen(true)}
      >
        Paste .env
      </button>
    );
  }

  return (
    <div
      className="envPasteBox"
      style={{
        marginTop: 10,
        padding: 12,
        border: '1px solid #2a2f3a',
        borderRadius: 8,
        background: '#0f1115',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 14 }}>Paste .env contents</strong>
        {serviceOptions.length > 0 && (
          <label className="inline" style={{ margin: 0 }}>
            Apply to:
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              style={{ marginLeft: 6 }}
            >
              <option value="">all services</option>
              {serviceOptions.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); reset(); }}
        placeholder={`# paste your .env here\nNODE_ENV=development\nPORT=8000\nMONGODB_URI=mongodb+srv://...\nJWT_SECRET=...`}
        spellCheck={false}
        rows={10}
        style={{
          width: '100%',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          lineHeight: 1.5,
          padding: 10,
          background: '#0b0d12',
          color: '#e6e8ee',
          border: '1px solid #2a2f3a',
          borderRadius: 6,
          boxSizing: 'border-box',
          resize: 'vertical',
        }}
      />

      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button type="button" onClick={handleImport}>Import</button>
        <button type="button" className="ghost" onClick={handleCancel}>Cancel</button>
      </div>

      {msg && <p className="ok">{msg}</p>}
      {warn && <p className="warn">{warn}</p>}
      {err && <p className="error">{err}</p>}
    </div>
  );
}