import { randomUUID } from 'node:crypto';

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

export const defaultSettings = {
  calorieTarget: 2000,
  days: 7,
  servings: 1,
  mealTypes: ['breakfast', 'lunch', 'dinner', 'snack'],
  dietaryStyle: 'No preference',
  allergies: '',
  avoidFoods: '',
  pantry: '',
  maxTotalMinutes: 40,
  budget: '',
  customInstructions: ''
};

export const mealSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'mealType', 'name', 'calories', 'servings', 'prepMinutes', 'cookMinutes',
    'ingredients', 'instructions', 'chefNote'
  ],
  properties: {
    mealType: { type: 'string', enum: MEAL_TYPES },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    calories: { type: 'integer', minimum: 50, maximum: 2500, description: 'Calories per serving' },
    servings: { type: 'integer', minimum: 1, maximum: 20 },
    prepMinutes: { type: 'integer', minimum: 0, maximum: 480 },
    cookMinutes: { type: 'integer', minimum: 0, maximum: 720 },
    ingredients: {
      type: 'array',
      minItems: 1,
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'amount', 'unit', 'notes'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 10000 },
          unit: { type: 'string', minLength: 1, maxLength: 30 },
          notes: { type: ['string', 'null'], maxLength: 120 }
        }
      }
    },
    instructions: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 500 }
    },
    chefNote: { type: ['string', 'null'], maxLength: 300 }
  }
};

export const mealPlanSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'targetCalories', 'servings', 'days'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: 'string', minLength: 1, maxLength: 600 },
    targetCalories: { type: 'integer', minimum: 800, maximum: 8000 },
    servings: { type: 'integer', minimum: 1, maximum: 20 },
    days: {
      type: 'array',
      minItems: 1,
      maxItems: 14,
      items: {
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
      }
    }
  }
};

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function sanitizeSettings(input = {}, base = defaultSettings) {
  const merged = { ...base, ...input };
  const mealTypes = Array.isArray(merged.mealTypes)
    ? merged.mealTypes.filter((x) => MEAL_TYPES.includes(x))
    : base.mealTypes;

  return {
    calorieTarget: clampInt(merged.calorieTarget, 800, 8000, base.calorieTarget),
    days: clampInt(merged.days, 1, 14, base.days),
    servings: clampInt(merged.servings, 1, 20, base.servings),
    mealTypes: mealTypes.length ? [...new Set(mealTypes)] : [...defaultSettings.mealTypes],
    dietaryStyle: String(merged.dietaryStyle || 'No preference').slice(0, 120),
    allergies: String(merged.allergies || '').slice(0, 1000),
    avoidFoods: String(merged.avoidFoods || '').slice(0, 1000),
    pantry: String(merged.pantry || '').slice(0, 3000),
    maxTotalMinutes: clampInt(merged.maxTotalMinutes, 5, 480, base.maxTotalMinutes),
    budget: String(merged.budget || '').slice(0, 300),
    customInstructions: String(merged.customInstructions || '').slice(0, 3000)
  };
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function assertDate(value, label = 'date') {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must use YYYY-MM-DD format.`);
  return text;
}

function normalizeMeal(raw, settings, { keepId = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Every meal must be an object.');
  const prepMinutes = Math.max(0, Math.round(safeNumber(raw.prepMinutes)));
  const cookMinutes = Math.max(0, Math.round(safeNumber(raw.cookMinutes)));
  const name = String(raw.name || '').trim();
  if (!name) throw new Error('Every meal needs a name.');

  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : []).map((ingredient) => ({
    name: String(ingredient?.name || '').trim(),
    amount: Math.max(0, safeNumber(ingredient?.amount)),
    unit: String(ingredient?.unit || 'item').trim(),
    notes: ingredient?.notes == null ? null : String(ingredient.notes).trim()
  })).filter((ingredient) => ingredient.name && ingredient.amount > 0);
  if (!ingredients.length) throw new Error(`Meal "${name}" needs at least one ingredient.`);

  const instructions = (Array.isArray(raw.instructions) ? raw.instructions : [])
    .map((step) => String(step || '').trim())
    .filter(Boolean);
  if (!instructions.length) throw new Error(`Meal "${name}" needs at least one instruction.`);

  return {
    id: keepId && raw.id ? String(raw.id) : randomUUID(),
    mealType: MEAL_TYPES.includes(raw.mealType) ? raw.mealType : 'dinner',
    name,
    calories: Math.max(0, Math.round(safeNumber(raw.calories))),
    servings: settings.servings,
    prepMinutes,
    cookMinutes,
    totalMinutes: prepMinutes + cookMinutes,
    ingredients,
    instructions,
    chefNote: raw.chefNote == null ? null : String(raw.chefNote).slice(0, 300)
  };
}

export function normalizeExternalPlan(raw, baseSettings = defaultSettings) {
  if (!raw || typeof raw !== 'object') throw new Error('Meal plan must be a JSON object.');
  const rawDays = Array.isArray(raw.days) ? raw.days : [];
  if (!rawDays.length) throw new Error('Meal plan needs at least one day.');

  const settings = sanitizeSettings({
    ...baseSettings,
    calorieTarget: raw.targetCalories ?? baseSettings.calorieTarget,
    servings: raw.servings ?? baseSettings.servings,
    days: rawDays.length
  }, baseSettings);

  const days = rawDays.slice(0, 14).map((day, dayIndex) => {
    const meals = (Array.isArray(day?.meals) ? day.meals : []).map((meal) => normalizeMeal(meal, settings));
    if (!meals.length) throw new Error(`Day ${dayIndex + 1} needs at least one meal.`);
    return {
      date: assertDate(day?.date, `Day ${dayIndex + 1} date`),
      totalCalories: meals.reduce((sum, meal) => sum + meal.calories, 0),
      totalPrepMinutes: meals.reduce((sum, meal) => sum + meal.prepMinutes, 0),
      totalCookMinutes: meals.reduce((sum, meal) => sum + meal.cookMinutes, 0),
      meals
    };
  });

  return {
    id: randomUUID(),
    title: String(raw.title || 'Meal Plan').trim().slice(0, 120) || 'Meal Plan',
    summary: String(raw.summary || '').trim().slice(0, 600),
    targetCalories: settings.calorieTarget,
    servings: settings.servings,
    days,
    createdAt: new Date().toISOString(),
    source: 'external-ai'
  };
}

// Backward-compatible name used by older tests/clients.
export const normalizeGeneratedPlan = normalizeExternalPlan;

export function recalculatePlan(plan) {
  const copy = structuredClone(plan);
  copy.days = (copy.days || []).map((day) => {
    const meals = (day.meals || []).map((meal) => ({
      ...meal,
      totalMinutes: safeNumber(meal.prepMinutes) + safeNumber(meal.cookMinutes)
    }));
    return {
      ...day,
      totalCalories: meals.reduce((sum, meal) => sum + safeNumber(meal.calories), 0),
      totalPrepMinutes: meals.reduce((sum, meal) => sum + safeNumber(meal.prepMinutes), 0),
      totalCookMinutes: meals.reduce((sum, meal) => sum + safeNumber(meal.cookMinutes), 0),
      meals
    };
  });
  copy.updatedAt = new Date().toISOString();
  return copy;
}

function ingredientKey(item) {
  return `${String(item.name).trim().toLowerCase()}|${String(item.unit).trim().toLowerCase()}`;
}

export function buildGroceryList(plan) {
  const map = new Map();

  for (const day of plan?.days || []) {
    for (const meal of day?.meals || []) {
      for (const item of meal?.ingredients || []) {
        const key = ingredientKey(item);
        if (!map.has(key)) {
          map.set(key, {
            name: item.name,
            amount: 0,
            unit: item.unit,
            notes: new Set(),
            usedIn: new Set()
          });
        }
        const bucket = map.get(key);
        bucket.amount += safeNumber(item.amount);
        if (item.notes) bucket.notes.add(item.notes);
        if (meal.name) bucket.usedIn.add(meal.name);
      }
    }
  }

  return [...map.values()]
    .map((item) => ({
      name: item.name,
      amount: Number(item.amount.toFixed(2)),
      unit: item.unit,
      notes: [...item.notes],
      usedIn: [...item.usedIn]
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getMealById(plan, mealId) {
  for (const day of plan?.days || []) {
    const meal = day.meals.find((candidate) => candidate.id === mealId);
    if (meal) return { day, meal };
  }
  return null;
}

export function replaceMealWithData(plan, mealId, rawMeal) {
  const found = getMealById(plan, mealId);
  if (!found) throw new Error('Meal not found.');
  const settings = sanitizeSettings({ servings: plan.servings, calorieTarget: plan.targetCalories });
  const replacement = normalizeMeal({ ...rawMeal, mealType: rawMeal.mealType || found.meal.mealType }, settings);
  replacement.id = mealId;
  replacement.replacedAt = new Date().toISOString();

  const copy = structuredClone(plan);
  const targetDay = copy.days.find((day) => day.date === found.day.date);
  targetDay.meals = targetDay.meals.map((meal) => meal.id === mealId ? replacement : meal);
  return recalculatePlan(copy);
}

export function parsePlanText(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Paste a meal-plan JSON object first.');
  const attempts = [raw];
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) attempts.push(fenced[1]);
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) attempts.push(raw.slice(firstBrace, lastBrace + 1));

  let lastError;
  for (const candidate of attempts) {
    try { return JSON.parse(candidate); } catch (error) { lastError = error; }
  }
  throw new Error(`Could not parse meal-plan JSON: ${lastError?.message || 'invalid JSON'}`);
}

export function buildGenerationPrompt(settingsInput = {}, { startDate } = {}) {
  const settings = sanitizeSettings(settingsInput);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(startDate || '') ? startDate : new Date().toISOString().slice(0, 10);
  const schemaExample = {
    title: '7-Day Meal Plan',
    summary: 'Short overview',
    targetCalories: settings.calorieTarget,
    servings: settings.servings,
    days: [{
      date,
      meals: [{
        mealType: settings.mealTypes[0] || 'breakfast',
        name: 'Meal name',
        calories: 500,
        servings: settings.servings,
        prepMinutes: 10,
        cookMinutes: 20,
        ingredients: [{ name: 'ingredient', amount: 1, unit: 'cup', notes: null }],
        instructions: ['Step one.', 'Step two.'],
        chefNote: null
      }]
    }]
  };

  return `Create a ${settings.days}-day meal plan beginning ${date}.

Constraints:
- Daily calorie target: about ${settings.calorieTarget} calories per person.
- Servings: ${settings.servings}. Ingredient amounts must be the TOTAL quantity needed for ${settings.servings} serving(s), while each meal's calories are PER PERSON / PER SERVING.
- Include these meal types each day: ${settings.mealTypes.join(', ')}.
- Dietary style: ${settings.dietaryStyle || 'No preference'}.
- Allergies / hard exclusions: ${settings.allergies || 'None provided'}.
- Foods to avoid: ${settings.avoidFoods || 'None provided'}.
- Pantry ingredients to prioritize where sensible: ${settings.pantry || 'None provided'}.
- Maximum prep + cook time for a meal: ${settings.maxTotalMinutes} minutes.
- Budget guidance: ${settings.budget || 'None provided'}.
- Extra instructions: ${settings.customInstructions || 'None provided'}.

For every meal include a calorie estimate, ingredient list with numeric quantities and units, prep time, cook time, and clear step-by-step instructions. Keep each day's meal calories reasonably close to the daily target. Never include an allergen listed above.

Return ONLY valid JSON, with no markdown fences or commentary, matching this shape:
${JSON.stringify(schemaExample, null, 2)}

Use unique real recipes rather than repeating the example values. The days array must contain exactly ${settings.days} consecutive dates starting on ${date}.`;
}
