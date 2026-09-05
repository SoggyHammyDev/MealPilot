import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { getSettings, getPlan, listPlans, savePlan, updateSettings } from './db.js';
import { buildGroceryList, sanitizeSettings } from './meal-plan.js';
import { generatePlanWithAI, replaceMealWithAI } from './openai.js';

const dataDir = process.env.DATA_DIR || path.resolve('data');
const tokenPath = path.join(dataDir, 'mcp-token.txt');

export function getMcpToken() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(tokenPath)) {
    const token = `mp_${crypto.randomBytes(32).toString('base64url')}`;
    fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  }
  return fs.readFileSync(tokenPath, 'utf8').trim();
}

export function rotateMcpToken() {
  const token = `mp_${crypto.randomBytes(32).toString('base64url')}`;
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

function asText(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function buildMcpServer() {
  const server = new McpServer({ name: 'mealpilot', version: '0.1.0' });

  server.registerTool('generate_meal_plan', {
    description: 'Generate and save a new MealPilot meal plan using the configured OpenAI account.',
    inputSchema: z.object({
      days: z.number().int().min(1).max(14).optional(),
      calorieTarget: z.number().int().min(800).max(8000).optional(),
      servings: z.number().int().min(1).max(20).optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dietaryStyle: z.string().max(120).optional(),
      allergies: z.string().max(1000).optional(),
      avoidFoods: z.string().max(1000).optional(),
      pantry: z.string().max(3000).optional(),
      maxTotalMinutes: z.number().int().min(5).max(480).optional(),
      budget: z.string().max(300).optional(),
      customInstructions: z.string().max(3000).optional()
    })
  }, async (args) => {
    const stored = getSettings({ includeSecret: true });
    const settings = sanitizeSettings(args, stored);
    const startDate = args.startDate || new Date().toISOString().slice(0, 10);
    const plan = await generatePlanWithAI(settings, startDate, stored.apiKey);
    savePlan(plan);
    return asText(plan);
  });

  server.registerTool('list_meal_plans', {
    description: 'List recently saved MealPilot plans.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() })
  }, async ({ limit }) => asText(listPlans(limit || 25)));

  server.registerTool('get_meal_plan', {
    description: 'Get a complete saved MealPilot plan by ID.',
    inputSchema: z.object({ planId: z.string().min(1) })
  }, async ({ planId }) => {
    const plan = getPlan(planId);
    if (!plan) throw new Error('Plan not found.');
    return asText(plan);
  });

  server.registerTool('get_grocery_list', {
    description: 'Build a combined grocery list for a saved MealPilot plan.',
    inputSchema: z.object({ planId: z.string().min(1) })
  }, async ({ planId }) => {
    const plan = getPlan(planId);
    if (!plan) throw new Error('Plan not found.');
    return asText(buildGroceryList(plan));
  });

  server.registerTool('replace_meal', {
    description: 'Replace one meal in an existing saved plan while keeping the day near its calorie target.',
    inputSchema: z.object({
      planId: z.string().min(1),
      mealId: z.string().min(1),
      notes: z.string().max(1000).optional()
    })
  }, async ({ planId, mealId, notes }) => {
    const plan = getPlan(planId);
    if (!plan) throw new Error('Plan not found.');
    const settings = getSettings({ includeSecret: true });
    const updated = await replaceMealWithAI({ plan, mealId, notes, settings, apiKey: settings.apiKey });
    savePlan(updated);
    return asText(updated);
  });

  server.registerTool('get_preferences', {
    description: 'Read MealPilot meal-planning preferences. Secrets are never returned.',
    inputSchema: z.object({})
  }, async () => asText(getSettings()));

  server.registerTool('update_preferences', {
    description: 'Update MealPilot meal-planning preferences. This cannot change the OpenAI API key.',
    inputSchema: z.object({
      calorieTarget: z.number().int().min(800).max(8000).optional(),
      days: z.number().int().min(1).max(14).optional(),
      servings: z.number().int().min(1).max(20).optional(),
      dietaryStyle: z.string().max(120).optional(),
      allergies: z.string().max(1000).optional(),
      avoidFoods: z.string().max(1000).optional(),
      pantry: z.string().max(3000).optional(),
      maxTotalMinutes: z.number().int().min(5).max(480).optional(),
      budget: z.string().max(300).optional(),
      customInstructions: z.string().max(3000).optional()
    })
  }, async (args) => asText(updateSettings(args)));

  return server;
}

const handler = createMcpHandler(buildMcpServer, { responseMode: 'json' });
export const mcpNodeHandler = toNodeHandler(handler, {
  onerror(error) {
    console.error('[mcp] adapter error', error);
  }
});

export async function closeMcp() {
  await handler.close();
}

export function requireMcpToken(req, res, next) {
  const auth = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) {
    res.set('WWW-Authenticate', 'Bearer realm="MealPilot MCP"');
    return res.status(401).json({ error: 'Missing MCP bearer token.' });
  }

  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(getMcpToken());
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    res.set('WWW-Authenticate', 'Bearer realm="MealPilot MCP"');
    return res.status(401).json({ error: 'Invalid MCP bearer token.' });
  }
  next();
}

export function validateMcpOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const originHost = new URL(origin).host;
    if (originHost !== req.get('host')) return res.status(403).json({ error: 'Cross-origin browser MCP requests are not allowed.' });
  } catch {
    return res.status(403).json({ error: 'Invalid Origin header.' });
  }
  next();
}
