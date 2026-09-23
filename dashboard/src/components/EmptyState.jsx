import React from 'react';

export default function EmptyState({ title, body, action }) {
  return (
    <div className="emptyState">
      <div className="emptyTitle">{title}</div>
      {body && <div className="emptyBody">{body}</div>}
      {action}
    </div>
  );
}