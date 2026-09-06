import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { defaultSettings, sanitizeSettings } from './meal-plan.js';

const dataDir = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'mealpilot.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    target_calories INTEGER NOT NULL,
    servings INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans(created_at DESC);
`);

const existing = db.prepare('SELECT id FROM settings WHERE id = 1').get();
if (!existing) {
  db.prepare('INSERT INTO settings (id, json, updated_at) VALUES (1, ?, ?)')
    .run(JSON.stringify(defaultSettings), new Date().toISOString());
}

// v0.1 had an openai_api_key column. Existing SQLite tables keep that column after
// upgrade, so clear it if present; new v0.3 databases never create it.
const settingsColumns = db.prepare('PRAGMA table_info(settings)').all().map((column) => column.name);
if (settingsColumns.includes('openai_api_key')) {
  db.prepare('UPDATE settings SET openai_api_key = NULL WHERE id = 1 AND openai_api_key IS NOT NULL').run();
}

export function getSettings() {
  const row = db.prepare('SELECT json FROM settings WHERE id = 1').get();
  return sanitizeSettings(JSON.parse(row?.json || '{}'));
}

export function updateSettings(input) {
  const current = getSettings();
  const next = sanitizeSettings(input, current);
  db.prepare('UPDATE settings SET json = ?, updated_at = ? WHERE id = 1')
    .run(JSON.stringify(next), new Date().toISOString());
  return getSettings();
}

export function updatePantry(pantry) {
  return updateSettings({ pantry: String(pantry || '') });
}

export function savePlan(plan) {
  const now = new Date().toISOString();
  const createdAt = plan.createdAt || now;
  const updated = { ...plan, createdAt, updatedAt: now };
  db.prepare(`
    INSERT INTO plans (id, title, target_calories, servings, created_at, updated_at, json)
    VALUES (@id, @title, @targetCalories, @servings, @createdAt, @updatedAt, @json)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      target_calories = excluded.target_calories,
      servings = excluded.servings,
      updated_at = excluded.updated_at,
      json = excluded.json
  `).run({
    id: updated.id,
    title: updated.title,
    targetCalories: updated.targetCalories,
    servings: updated.servings,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    json: JSON.stringify(updated)
  });
  return updated;
}

export function getPlan(id) {
  const row = db.prepare('SELECT json FROM plans WHERE id = ?').get(id);
  return row ? JSON.parse(row.json) : null;
}

export function listPlans(limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  return db.prepare(`
    SELECT id, title, target_calories AS targetCalories, servings, created_at AS createdAt, updated_at AS updatedAt
    FROM plans
    ORDER BY created_at DESC
    LIMIT ?
  `).all(safeLimit);
}

export function deletePlan(id) {
  return db.prepare('DELETE FROM plans WHERE id = ?').run(id).changes > 0;
}
