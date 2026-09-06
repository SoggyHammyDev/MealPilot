import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import {
  deletePlan,
  getPlan,
  getSettings,
  listPlans,
  savePlan,
  updatePantry,
  updateSettings
} from './db.js';
import {
  buildGenerationPrompt,
  buildGroceryList,
  normalizeExternalPlan,
  replaceMealWithData,
  sanitizeSettings
} from './meal-plan.js';

const dataDir = process.env.DATA_DIR || path.resolve('data');
const tokenPath = path.join(dataDir, 'mcp-token.txt');

export function getMcpAuthMode() {
  return String(process.env.MCP_AUTH_MODE || 'token').toLowerCase() === 'none' ? 'none' : 'token';
}

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

const ingredientInput = z.object({
  name: z.string().min(1).max(100),
  amount: z.number().positive().max(10000),
  unit: z.string().min(1).max(30),
  notes: z.string().max(120).nullable().optional()
});

const mealInput = z.object({
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  name: z.string().min(1).max(120),
  calories: z.number().int().min(50).max(2500),
  servings: z.number().int().min(1).max(20).optional(),
  prepMinutes: z.number().int().min(0).max(480),
  cookMinutes: z.number().int().min(0).max(720),
  ingredients: z.array(ingredientInput).min(1).max(40),
  instructions: z.array(z.string().min(1).max(500)).min(1).max(20),
  chefNote: z.string().max(300).nullable().optional()
});

const planInput = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(600).default(''),
  targetCalories: z.number().int().min(800).max(8000).optional(),
  servings: z.number().int().min(1).max(20).optional(),
  days: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    meals: z.array(mealInput).min(1).max(6)
  })).min(1).max(14)
});

const preferencesInput = z.object({
  calorieTarget: z.number().int().min(800).max(8000).optional(),
  days: z.number().int().min(1).max(14).optional(),
  servings: z.number().int().min(1).max(20).optional(),
  mealTypes: z.array(z.enum(['breakfast', 'lunch', 'dinner', 'snack'])).min(1).max(4).optional(),
  dietaryStyle: z.string().max(120).optional(),
  allergies: z.string().max(1000).optional(),
  avoidFoods: z.string().max(1000).optional(),
  maxTotalMinutes: z.number().int().min(5).max(480).optional(),
  budget: z.string().max(300).optional(),
  customInstructions: z.string().max(3000).optional()
});

function buildMcpServer() {
  const server = new McpServer({ name: 'mealpilot', version: '0.3.1' });

  server.registerTool('get_mealpilot_context', {
    description: 'Call this before creating a meal plan. Returns the user\'s saved calorie target, serving count, dietary constraints, pantry, cooking-time limit, budget guidance, and a generation brief. After you create the plan, call save_meal_plan to store it in MealPilot.',
    inputSchema: z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    })
  }, async ({ startDate }) => {
    const settings = getSettings();
    return asText({
      preferences: settings,
      generationPrompt: buildGenerationPrompt(settings, { startDate }),
      workflow: [
        'Generate the meal plan yourself using these preferences.',
        'Treat allergies as hard exclusions.',
        'Use calorie estimates per serving and ingredient quantities for the configured total servings.',
        'Call save_meal_plan with the completed structured plan.'
      ]
    });
  });

  server.registerTool('get_preferences', {
    description: 'Read the user\'s saved MealPilot planning preferences. No API key is used or stored by MealPilot.',
    inputSchema: z.object({})
  }, async () => asText(getSettings()));

  server.registerTool('update_preferences', {
    description: 'Update the user\'s MealPilot planning preferences, excluding pantry contents. Use update_pantry for pantry changes.',
    inputSchema: preferencesInput
  }, async (args) => asText(updateSettings(args)));

  server.registerTool('get_pantry', {
    description: 'Read the pantry / ingredients the user already has and wants prioritized in future meal plans.',
    inputSchema: z.object({})
  }, async () => asText({ pantry: getSettings().pantry }));

  server.registerTool('update_pantry', {
    description: 'Replace the saved pantry text used for future meal-plan generation.',
    inputSchema: z.object({ pantry: z.string().max(3000) })
  }, async ({ pantry }) => asText({ pantry: updatePantry(pantry).pantry }));

  server.registerTool('list_meal_plans', {
    description: 'List recently saved MealPilot plans and their IDs.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() })
  }, async ({ limit }) => asText(listPlans(limit || 25)));

  server.registerTool('get_meal_plan', {
    description: 'Read a complete saved MealPilot plan by plan ID, including meal IDs needed for replacement.',
    inputSchema: z.object({ planId: z.string().min(1) })
  }, async ({ planId }) => {
    const plan = getPlan(planId);
    if (!plan) throw new Error('Plan not found.');
    return asText(plan);
  });

  server.registerTool('get_grocery_list', {
    description: 'Return a combined grocery list for a saved plan. Repeated ingredients with matching units are merged.',
    inputSchema: z.object({ planId: z.string().min(1) })
  }, async ({ planId }) => {
    const plan = getPlan(planId);
    if (!plan) throw new Error('Plan not found.');
    return asText(buildGroceryList(plan));
  });

  server.registerTool('save_meal_plan', {
    description: 'Save a meal plan that YOU already generated. MealPilot does not call an AI provider. First read MealPilot context/preferences, generate the meals yourself, then pass the complete structured plan here. Ingredient amounts should cover all configured servings; calories are per person/per serving.',
    inputSchema: planInput
  }, async (args) => {
    const settings = getSettings();
    const normalized = normalizeExternalPlan(args, sanitizeSettings({
      ...settings,
      calorieTarget: args.targetCalories ?? settings.calorieTarget,
      servings: args.servings ?? settings.servings,
      days: args.days.length
    }, settings));
    return asText(savePlan(normalized));
  });

  server.registerTool('replace_meal', {
    description: 'Replace one meal with a replacement meal that YOU already generated. This tool does not call AI. Read the plan first, create a replacement with similar calories unless the user asked otherwise, then save it here.',
    inputSchema: z.object({
      planId: z.string().min(1),
      mealId: z.string().min(1),
      replacement: mealInput
    })
  }, async ({ planId, mealId, replacement }) => {
    const plan = getPlan(planId);
    if (!plan) throw new Error('Plan not found.');
    const updated = replaceMealWithData(plan, mealId, replacement);
    return asText(savePlan(updated));
  });

  server.registerTool('delete_meal_plan', {
    description: 'Permanently delete a saved MealPilot plan by ID.',
    inputSchema: z.object({ planId: z.string().min(1) })
  }, async ({ planId }) => asText({ deleted: deletePlan(planId), planId }));

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

export function requireMcpAuth(req, res, next) {
  if (getMcpAuthMode() === 'none') return next();

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
