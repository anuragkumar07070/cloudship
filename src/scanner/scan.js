import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next']);

/**
 * Walk the repo tree and return candidate service roots (relative paths).
 * Rules from spec § Stage 3.
 */
export function scanForServiceRoots(repoRoot) {
  const roots = [];
  walk(repoRoot, repoRoot, roots);
  return roots;
}

function walk(absDir, repoRoot, roots) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch { return; }

  // Does this directory contain package.json?
  const pkgEntry = entries.find((e) => e.isFile() && e.name === 'package.json');
  if (pkgEntry) {
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(path.join(absDir, 'package.json'), 'utf8')); }
    catch { pkg = null; }

    const isMonorepoRoot = pkg && pkg.workspaces;
    if (!isMonorepoRoot) {
      const rel = path.relative(repoRoot, absDir) || '.';
      roots.push(rel);
      return; // do NOT descend further
    }
    // monorepo root: keep descending, don't record
  }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (SKIP.has(e.name)) continue;
    walk(path.join(absDir, e.name), repoRoot, roots);
  }
}