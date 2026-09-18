import React, { useRef, useState } from 'react';
import { parseDotenv } from '../lib/parseDotenv.js';

export default function EnvUploader({ serviceOptions = [], onParsed }) {
  const inputRef = useRef(null);
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const openPicker = () => inputRef.current?.click();

  const onChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-uploading the same file
    if (!file) return;

    setBusy(true); setMsg(null); setErr(null);
    try {
      const text = await file.text();
      const parsed = parseDotenv(text);
      if (parsed.length === 0) {
        setErr(`No KEY=VALUE pairs found in ${file.name}`);
        return;
      }
      onParsed(parsed, { serviceName: scope, fileName: file.name });
      setMsg(`Imported ${parsed.length} variable${parsed.length === 1 ? '' : 's'} from ${file.name}`);
    } catch (e2) {
      setErr(`Failed to read file: ${e2.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="envUploader">
      <div className="envUploaderRow">
        {serviceOptions.length > 0 && (
          <label className="inline">
            Apply to:
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">all services</option>
              {serviceOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="ghost" onClick={openPicker} disabled={busy}>
          {busy ? 'Reading…' : 'Upload .env file'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".env,text/plain"
          style={{ display: 'none' }}
          onChange={onChange}
        />
      </div>
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="error">{err}</p>}
    </div>
  );
}