import React from 'react';

const MAP = {
  running:              { cls: 'pill-green',  label: 'running' },
  stopped:              { cls: 'pill-gray',   label: 'stopped' },
  failed:               { cls: 'pill-red',    label: 'failed' },
  building:             { cls: 'pill-amber',  label: 'building',   pulse: true },
  starting:             { cls: 'pill-amber',  label: 'starting',   pulse: true },
  stopping:             { cls: 'pill-amber',  label: 'stopping',   pulse: true },
  'health-check':       { cls: 'pill-amber',  label: 'health-check', pulse: true },
  cloning:              { cls: 'pill-blue',   label: 'cloning',    pulse: true },
  scanning:             { cls: 'pill-blue',   label: 'scanning',   pulse: true },
  'awaiting-confirmation': { cls: 'pill-blue', label: 'awaiting confirm' },
};

export default function StatusPill({ status }) {
  const s = MAP[status] || { cls: 'pill-gray', label: status || 'unknown' };
  return (
    <span className={`pill ${s.cls}${s.pulse ? ' pulse' : ''}`}>{s.label}</span>
  );
}