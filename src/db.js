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
    openai_api_key TEXT,
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
  db.prepare('INSERT INTO settings (id, json, openai_api_key, updated_at) VALUES (1, ?, NULL, ?)')
    .run(JSON.stringify(defaultSettings), new Date().toISOString());
}

export function getSettings({ includeSecret = false } = {}) {
  const row = db.prepare('SELECT json, openai_api_key FROM settings WHERE id = 1').get();
  const settings = sanitizeSettings(JSON.parse(row.json || '{}'));
  const envKey = process.env.OPENAI_API_KEY?.trim();
  const storedKey = row.openai_api_key?.trim();
  return {
    ...settings,
    hasApiKey: Boolean(envKey || storedKey),
    apiKeySource: envKey ? 'environment' : storedKey ? 'stored' : 'none',
    ...(includeSecret ? { apiKey: envKey || storedKey || '' } : {})
  };
}

export function updateSettings(input) {
  const current = getSettings();
  const next = sanitizeSettings(input, current);
  db.prepare('UPDATE settings SET json = ?, updated_at = ? WHERE id = 1')
    .run(JSON.stringify(next), new Date().toISOString());
  return getSettings();
}

export function setOpenAiKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key.startsWith('sk-')) throw new Error('OpenAI API key should begin with sk-.');
  db.prepare('UPDATE settings SET openai_api_key = ?, updated_at = ? WHERE id = 1')
    .run(key, new Date().toISOString());
  return getSettings();
}

export function clearOpenAiKey() {
  db.prepare('UPDATE settings SET openai_api_key = NULL, updated_at = ? WHERE id = 1')
    .run(new Date().toISOString());
  return getSettings();
}

export function savePlan(plan) {
  const now = new Date().toISOString();
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
    id: plan.id,
    title: plan.title,
    targetCalories: plan.targetCalories,
    servings: plan.servings,
    createdAt: plan.createdAt || now,
    updatedAt: now,
    json: JSON.stringify(plan)
  });
  return plan;
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
