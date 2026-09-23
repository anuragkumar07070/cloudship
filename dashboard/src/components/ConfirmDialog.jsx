import React from 'react';

export default function ConfirmDialog({
  open, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  busy = false, onConfirm, onCancel, danger = false,
}) {
  if (!open) return null;
  return (
    <div className="dialogBackdrop" role="dialog" aria-modal="true">
      <div className="dialog">
        <div className="dialogTitle">{title}</div>
        {body && <div className="dialogBody">{body}</div>}
        <div className="dialogActions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}