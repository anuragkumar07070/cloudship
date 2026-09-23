import React from 'react';

function IconDeployments() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

const ITEMS = [
  { key: 'deployments', label: 'Deployments', icon: <IconDeployments /> },
  { key: 'new',         label: 'New Deployment', icon: <IconPlus /> },
  { key: 'settings',    label: 'Settings', icon: <IconSettings /> },
];

export default function Sidebar({ active, onDeployments, onNewDeployment, onSettings }) {
  const handlers = {
    deployments: onDeployments,
    new: onNewDeployment,
    settings: onSettings,
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandMark">CS</div>
        <div className="brandText">
          <div className="brandName">CloudShip</div>
          <div className="brandTag">Deploy from GitHub</div>
        </div>
      </div>

      <nav className="navList">
        {ITEMS.map((item) => {
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`navItem${isActive ? ' active' : ''}`}
              onClick={handlers[item.key]}
            >
              <span className="navIcon">{item.icon}</span>
              <span className="navLabel">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebarFooter">
        <div className="sidebarHint">v1 · no auth</div>
      </div>
    </aside>
  );
}