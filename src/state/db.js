import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  repoUrl TEXT NOT NULL,
  branch TEXT NOT NULL,
  status TEXT NOT NULL,
  urls TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  manifest TEXT,
  composePath INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deploymentId TEXT NOT NULL,
  name TEXT NOT NULL,
  rootPath TEXT NOT NULL,
  type TEXT NOT NULL,
  port INTEGER,
  isPublic INTEGER NOT NULL DEFAULT 0,
  containerId TEXT,
  containerStatus TEXT
);

CREATE TABLE IF NOT EXISTS env_vars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deploymentId TEXT NOT NULL,
  serviceName TEXT,
  key TEXT NOT NULL,
  value TEXT NOT NULL
);
`);