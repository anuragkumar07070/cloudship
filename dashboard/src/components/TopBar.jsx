import React from 'react';

export default function TopBar({ query, onQueryChange }) {
  return (
    <header className="topBar">
      <div className="topBarBrand">CloudShip</div>

      <div className="searchWrap">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="text"
          placeholder="Search by repo URL or id…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="searchClear"
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      <div className="topBarRight" />
    </header>
  );
}