import { randomUUID } from 'node:crypto';
import { mealSchema, normalizeExternalPlan, sanitizeSettings } from './meal-plan.js';

const OLLAMA_URL = String(process.env.OLLAMA_URL || 'http://ollama:11434').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3:4b-instruct';
const pullState = new Map();

function modelName(value) {
  return String(value || DEFAULT_MODEL).trim().slice(0, 160) || DEFAULT_MODEL;
}

async function ollamaFetch(path, options = {}) {
  const response = await fetch(`${OLLAMA_URL}${path}`, options);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {}
    const error = new Error(`Ollama: ${message}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

export async function listLocalModels() {
  const response = await ollamaFetch('/api/tags', { signal: AbortSignal.timeout(8000) });
  const body = await response.json();
  return Array.isArray(body?.models) ? body.models : [];
}

export async function getLocalAiStatus(requestedModel = DEFAULT_MODEL) {
  const model = modelName(requestedModel);
  try {
    const models = await listLocalModels();
    const installed = models.some((item) => item?.name === model || item?.model === model);
    const pull = pullState.get(model) || null;
    return {
      connected: true,
      model,
      installed,
      models: models.map((item) => ({
        name: item.name || item.model,
        size: Number(item.size || 0),
        parameterSize: item.details?.parameter_size || null,
        quantization: item.details?.quantization_level || null
      })),
      pull
    };
  } catch (error) {
    return {
      connected: false,
      model,
      installed: false,
      models: [],
      pull: pullState.get(model) || null,
      error: error.message
    };
  }
}

function updatePull(model, patch) {
  const previous = pullState.get(model) || { status: 'idle', completed: 0, total: 0, percent: 0 };
  const next = { ...previous, ...patch, updatedAt: new Date().toISOString() };
  if (Number(next.total) > 0) next.percent = Math.max(0, Math.min(100, Math.round((Number(next.completed) / Number(next.total)) * 100)));
  pullState.set(model, next);
  return next;
}

async function runPull(model) {
  updatePull(model, { status: 'starting', error: null, completed: 0, total: 0, percent: 0 });
  try {
    const response = await ollamaFetch('/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true })
    });

    const decoder = new TextDecoder();
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Ollama did not return a download stream.');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.error) throw new Error(event.error);
        updatePull(model, {
          status: event.status || 'downloading',
          completed: Number(event.completed || 0),
          total: Number(event.total || 0)
        });
      }
    }

    updatePull(model, { status: 'success', percent: 100 });
  } catch (error) {
    updatePull(model, { status: 'error', error: error.message });
  }
}

export function startModelPull(requestedModel = DEFAULT_MODEL) {
  const model = modelName(requestedModel);
  const current = pullState.get(model);
  if (current && !['success', 'error'].includes(current.status)) return current;
  void runPull(model);
  return updatePull(model, { status: 'starting', error: null, completed: 0, total: 0, percent: 0 });
}

export function getModelPullState(requestedModel = DEFAULT_MODEL) {
  const model = modelName(requestedModel);
  return pullState.get(model) || { status: 'idle', completed: 0, total: 0, percent: 0, error: null };
}


function dateAtOffset(startDate, offset) {
  const match = String(startDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const base = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date();
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

function mealDaySchemaFor(settings) {
  const maxMinutes = Math.max(5, Number(settings?.maxTotalMinutes || 40));
  const boundedMealSchema = {
    ...mealSchema,
    properties: {
      ...mealSchema.properties,
      prepMinutes: {
        ...mealSchema.properties.prepMinutes,
        maximum: maxMinutes,
        description: `Prep minutes. prepMinutes + cookMinutes MUST be <= ${maxMinutes}.`
      },
      cookMinutes: {
        ...mealSchema.properties.cookMinutes,
        maximum: maxMinutes,
        description: `Cook minutes. prepMinutes + cookMinutes MUST be <= ${maxMinutes}.`
      }
    }
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['date', 'meals'],
    properties: {
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      meals: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: boundedMealSchema
      }
    }
  };
}

function systemPrompt() {
  return [
    'You are MealPilot, a practical meal-planning assistant running locally on the user\'s Umbrel.',
    'Return only data that conforms to the supplied JSON schema.',
    'Treat allergies and hard exclusions as strict safety constraints.',
    'Respect the requested meal types, serving count, daily calorie target, and maximum per-meal total time.',
    'Prefer pantry ingredients where reasonable, but include missing ingredients needed for complete meals.',
    'Calories are estimates, not medical advice. Keep daily calories reasonably close to the requested target.',
    'Ingredient amounts are for the full requested serving count, while calories are per serving.',
    'Use ordinary grocery-store ingredients and concise, actionable cooking instructions.'
  ].join(' ');
}


function calorieBudgetForMealTypes(settings) {
  const weights = { breakfast: 0.25, lunch: 0.30, dinner: 0.35, snack: 0.10 };
  const types = settings.mealTypes;
  const weightTotal = types.reduce((sum, type) => sum + (weights[type] || 1), 0);
  let remaining = settings.calorieTarget;
  const targets = {};

  types.forEach((type, index) => {
    if (index === types.length - 1) {
      targets[type] = remaining;
      return;
    }
    const target = Math.max(50, Math.round(settings.calorieTarget * (weights[type] || 1) / weightTotal));
    targets[type] = target;
    remaining -= target;
  });

  return targets;
}

function calorieBudgetText(settings) {
  const budget = calorieBudgetForMealTypes(settings);
  return settings.mealTypes.map((type) => `${type}: about ${budget[type]} calories`).join('; ');
}

function dayPrompt(settings, { date, dayNumber, totalDays, usedMeals = [] }) {
  return [
    `Generate day ${dayNumber} of ${totalDays} for ${date}.`,
    `Daily calorie target per person: ${settings.calorieTarget}. Aim as close to this total as possible.`,
    `CALORIE BUDGET PER MEAL: ${calorieBudgetText(settings)}. These targets add up to exactly ${settings.calorieTarget} calories per person.`,
    `Keep each meal reasonably close to its calorie budget and verify the day total by adding every meal calorie value before returning JSON.`,
    `Servings: ${settings.servings}.`,
    `Required meal types: ${settings.mealTypes.join(', ')}. Include each required type exactly once and do not add extra meals.`,
    `Dietary style: ${settings.dietaryStyle}.`,
    `Allergies / hard exclusions: ${settings.allergies || 'None provided'}.`,
    `Foods to avoid: ${settings.avoidFoods || 'None provided'}.`,
    `Pantry ingredients to prioritize: ${settings.pantry || 'None provided'}.`,
    `HARD LIMIT: For EVERY meal, prepMinutes + cookMinutes must be ${settings.maxTotalMinutes} minutes or less.`,
    `Before returning JSON, explicitly verify the arithmetic for each meal. Example: with a ${settings.maxTotalMinutes}-minute limit, 15 prep + 30 cook = 45 is INVALID; choose a faster recipe or faster method instead.`,
    `Budget guidance: ${settings.budget || 'None provided'}.`,
    `Extra instructions: ${settings.customInstructions || 'None provided'}.`,
    usedMeals.length ? `Avoid repeating these meal names from earlier days: ${usedMeals.join('; ')}.` : 'Favor variety across the day.',
    `The date field must be exactly ${date}.`,
    'Return only the JSON object required by the schema.'
  ].join('\n');
}

function validateDay(rawDay, settings, expectedDate) {
  if (!rawDay || typeof rawDay !== 'object') throw new Error('The model did not return a day object.');
  if (rawDay.date !== expectedDate) throw new Error(`Expected date ${expectedDate}, received ${rawDay.date || 'none'}.`);
  const rawMeals = Array.isArray(rawDay.meals) ? rawDay.meals : [];
  if (rawMeals.length !== settings.mealTypes.length) {
    throw new Error(`Day ${expectedDate} must contain exactly ${settings.mealTypes.length} meals (${settings.mealTypes.join(', ')}), but the model returned ${rawMeals.length}.`);
  }
  const counts = new Map();
  for (const meal of rawMeals) counts.set(meal?.mealType, (counts.get(meal?.mealType) || 0) + 1);
  for (const type of settings.mealTypes) {
    const count = counts.get(type) || 0;
    if (count === 0) throw new Error(`Day ${expectedDate} is missing ${type}.`);
    if (count !== 1) throw new Error(`Day ${expectedDate} must contain exactly one ${type}, but the model returned ${count}.`);
  }
  for (const meal of rawMeals) {
    const totalMinutes = Number(meal?.prepMinutes || 0) + Number(meal?.cookMinutes || 0);
    if (totalMinutes > settings.maxTotalMinutes) {
      throw new Error(`${meal?.name || 'A meal'} is ${Number(meal?.prepMinutes || 0)} min prep + ${Number(meal?.cookMinutes || 0)} min cook = ${totalMinutes} minutes, which exceeds the ${settings.maxTotalMinutes}-minute meal-time limit.`);
    }
  }
  const totalCalories = rawMeals.reduce((sum, meal) => sum + Number(meal?.calories || 0), 0);
  const minCalories = Math.round(settings.calorieTarget * 0.8);
  const maxCalories = Math.round(settings.calorieTarget * 1.2);
  const deviation = Math.abs(totalCalories - settings.calorieTarget) / settings.calorieTarget;
  if (deviation > 0.2) {
    const difference = settings.calorieTarget - totalCalories;
    const direction = difference > 0 ? `ADD about ${Math.abs(difference)} calories` : `REMOVE about ${Math.abs(difference)} calories`;
    throw new Error(`Day ${expectedDate} totals ${totalCalories} calories. Target is ${settings.calorieTarget}; acceptable range is ${minCalories}-${maxCalories}. ${direction} by adjusting realistic ingredient portions or replacing meals.`);
  }
  return rawDay;
}

async function generateDay(settings, { date, dayNumber, totalDays, model, usedMeals }) {
  let lastError;
  let previousContent = null;
  const prompt = dayPrompt(settings, { date, dayNumber, totalDays, usedMeals });
  const format = mealDaySchemaFor(settings);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const messages = [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: prompt }
      ];

      if (attempt > 1) {
        if (previousContent) messages.push({ role: 'assistant', content: previousContent });
        messages.push({
          role: 'user',
          content: [
            `That day failed validation: ${lastError?.message || 'invalid output'}`,
            'Return a corrected COMPLETE day object, not an explanation.',
            `The ${settings.maxTotalMinutes}-minute meal-time limit is a hard constraint: prepMinutes + cookMinutes must be <= ${settings.maxTotalMinutes} for every single meal.`,
            'If a recipe cannot realistically fit the limit, REPLACE that meal with a genuinely faster recipe or method instead of inventing an unrealistic time estimate.',
            `Calorie budget: ${calorieBudgetText(settings)}. The complete day should total about ${settings.calorieTarget} calories per person.`,
            `Before answering, add the meal calories yourself and make sure the total is between ${Math.round(settings.calorieTarget * 0.8)} and ${Math.round(settings.calorieTarget * 1.2)}, aiming near ${settings.calorieTarget}.`,
            'Do NOT fix calorie validation by changing calorie numbers alone. Adjust ingredient quantities/portions so the calorie estimate remains plausible, or replace a meal.',
            'Re-check every required meal type, calorie total, ingredient list, and time sum before answering.'
          ].join('\n')
        });
      }

      const response = await ollamaFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          think: false,
          format,
          keep_alive: '10m',
          options: {
            temperature: attempt === 1 ? 0.25 : 0.12,
            num_ctx: 16384,
            num_predict: 3500
          }
        })
      });
      const body = await response.json();
      const content = body?.message?.content;
      if (!content) throw new Error('Local model returned an empty response.');
      previousContent = content;
      const raw = JSON.parse(content);
      return {
        day: validateDay(raw, settings, date),
        usage: {
          promptEvalCount: body.prompt_eval_count ?? null,
          evalCount: body.eval_count ?? null,
          totalDurationNs: body.total_duration ?? null
        }
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not generate ${date}: ${lastError?.message || 'unknown validation error'}`);
}

export async function generateLocalMealPlan(settingsInput = {}, { startDate, model: requestedModel, onProgress } = {}) {
  const settings = sanitizeSettings(settingsInput);
  const model = modelName(requestedModel || settings.aiModel);
  const firstDate = /^\d{4}-\d{2}-\d{2}$/.test(startDate || '') ? startDate : new Date().toISOString().slice(0, 10);
  const days = [];
  const usedMeals = [];
  const usage = { promptEvalCount: 0, evalCount: 0, totalDurationNs: 0 };

  for (let index = 0; index < settings.days; index += 1) {
    const date = dateAtOffset(firstDate, index);
    onProgress?.({ day: index + 1, totalDays: settings.days, date, message: `Generating day ${index + 1} of ${settings.days}…` });
    const result = await generateDay(settings, {
      date,
      dayNumber: index + 1,
      totalDays: settings.days,
      model,
      usedMeals: usedMeals.slice(-20)
    });
    days.push(result.day);
    usedMeals.push(...result.day.meals.map((meal) => meal.name).filter(Boolean));
    for (const key of Object.keys(usage)) {
      if (Number.isFinite(Number(result.usage[key]))) usage[key] += Number(result.usage[key]);
    }
  }

  const rawPlan = {
    title: settings.days === 1 ? 'Meal Plan' : `${settings.days}-Day Meal Plan`,
    summary: `Generated locally with ${model} using your saved MealPilot preferences.`,
    targetCalories: settings.calorieTarget,
    servings: settings.servings,
    days
  };
  const plan = normalizeExternalPlan(rawPlan, settings);
  plan.source = 'local-ollama';
  plan.model = model;
  plan.generation = { provider: 'ollama', ...usage };
  return plan;
}

const jobs = new Map();
let activeJobId = null;

function jobView(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    message: job.message,
    model: job.model,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error || null,
    plan: job.status === 'done' ? job.plan : undefined
  };
}

export function startGenerationJob({ settings, startDate, model, savePlan }) {
  if (activeJobId) {
    const active = jobs.get(activeJobId);
    if (active && ['queued', 'generating', 'saving'].includes(active.status)) {
      const error = new Error('A meal plan is already being generated.');
      error.status = 409;
      error.job = jobView(active);
      throw error;
    }
  }

  const id = randomUUID();
  const job = {
    id,
    status: 'queued',
    message: 'Preparing local AI…',
    model: modelName(model || settings?.aiModel),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    plan: null
  };
  jobs.set(id, job);
  activeJobId = id;

  void (async () => {
    try {
      Object.assign(job, { status: 'generating', message: 'Generating your meal plan locally…', updatedAt: new Date().toISOString() });
      const plan = await generateLocalMealPlan(settings, {
        startDate,
        model: job.model,
        onProgress: ({ day, totalDays, date }) => {
          Object.assign(job, {
            status: 'generating',
            message: `Generating day ${day} of ${totalDays} (${date})…`,
            updatedAt: new Date().toISOString()
          });
        }
      });
      Object.assign(job, { status: 'saving', message: 'Saving plan to MealPilot…', updatedAt: new Date().toISOString() });
      job.plan = savePlan(plan);
      Object.assign(job, { status: 'done', message: 'Meal plan ready.', updatedAt: new Date().toISOString() });
    } catch (error) {
      Object.assign(job, { status: 'error', message: 'Generation failed.', error: error.message, updatedAt: new Date().toISOString() });
    } finally {
      if (activeJobId === id) activeJobId = null;
      setTimeout(() => jobs.delete(id), 60 * 60 * 1000).unref?.();
    }
  })();

  return jobView(job);
}

export function getGenerationJob(id) {
  return jobView(jobs.get(id));
}
