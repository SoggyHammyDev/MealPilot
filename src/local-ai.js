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

const mealDaySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['date', 'meals'],
  properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    meals: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: mealSchema
    }
  }
};

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

function dayPrompt(settings, { date, dayNumber, totalDays, usedMeals = [] }) {
  return [
    `Generate day ${dayNumber} of ${totalDays} for ${date}.`,
    `Daily calorie target per person: ${settings.calorieTarget}. Aim within about 10% when practical.`,
    `Servings: ${settings.servings}.`,
    `Required meal types: ${settings.mealTypes.join(', ')}. Include each required type exactly once unless a snack reasonably needs a second entry.`,
    `Dietary style: ${settings.dietaryStyle}.`,
    `Allergies / hard exclusions: ${settings.allergies || 'None provided'}.`,
    `Foods to avoid: ${settings.avoidFoods || 'None provided'}.`,
    `Pantry ingredients to prioritize: ${settings.pantry || 'None provided'}.`,
    `Maximum prep + cook time for any single meal: ${settings.maxTotalMinutes} minutes.`,
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
  const types = new Set(rawMeals.map((meal) => meal?.mealType));
  for (const type of settings.mealTypes) {
    if (!types.has(type)) throw new Error(`Day ${expectedDate} is missing ${type}.`);
  }
  for (const meal of rawMeals) {
    const totalMinutes = Number(meal?.prepMinutes || 0) + Number(meal?.cookMinutes || 0);
    if (totalMinutes > settings.maxTotalMinutes) {
      throw new Error(`${meal?.name || 'A meal'} exceeds the ${settings.maxTotalMinutes}-minute meal-time limit.`);
    }
  }
  const totalCalories = rawMeals.reduce((sum, meal) => sum + Number(meal?.calories || 0), 0);
  const deviation = Math.abs(totalCalories - settings.calorieTarget) / settings.calorieTarget;
  if (deviation > 0.2) throw new Error(`Day ${expectedDate} is too far from the ${settings.calorieTarget}-calorie target.`);
  return rawDay;
}

async function generateDay(settings, { date, dayNumber, totalDays, model, usedMeals }) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const prompt = dayPrompt(settings, { date, dayNumber, totalDays, usedMeals });
      const response = await ollamaFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt() },
            {
              role: 'user',
              content: attempt === 1
                ? prompt
                : `${prompt}\n\nYour previous response failed validation: ${lastError?.message || 'invalid output'}. Correct the issue and regenerate this day.`
            }
          ],
          stream: false,
          think: false,
          format: mealDaySchema,
          keep_alive: '10m',
          options: {
            temperature: attempt === 1 ? 0.25 : 0,
            num_ctx: 16384,
            num_predict: 3500
          }
        })
      });
      const body = await response.json();
      const content = body?.message?.content;
      if (!content) throw new Error('Local model returned an empty response.');
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
