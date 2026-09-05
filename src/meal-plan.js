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
  model: 'gpt-5.6-luna',
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
          amount: { type: 'number', minimum: 0.01, maximum: 10000 },
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
  required: ['title', 'summary', 'days'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: 'string', minLength: 1, maxLength: 600 },
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
    : defaultSettings.mealTypes;

  return {
    calorieTarget: clampInt(merged.calorieTarget, 800, 8000, base.calorieTarget),
    days: clampInt(merged.days, 1, 14, base.days),
    servings: clampInt(merged.servings, 1, 20, base.servings),
    mealTypes: mealTypes.length ? [...new Set(mealTypes)] : defaultSettings.mealTypes,
    dietaryStyle: String(merged.dietaryStyle || 'No preference').slice(0, 120),
    allergies: String(merged.allergies || '').slice(0, 1000),
    avoidFoods: String(merged.avoidFoods || '').slice(0, 1000),
    pantry: String(merged.pantry || '').slice(0, 3000),
    maxTotalMinutes: clampInt(merged.maxTotalMinutes, 5, 480, base.maxTotalMinutes),
    budget: String(merged.budget || '').slice(0, 300),
    model: String(merged.model || 'gpt-5.6-luna').slice(0, 100),
    customInstructions: String(merged.customInstructions || '').slice(0, 3000)
  };
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeGeneratedPlan(raw, settings) {
  const safe = sanitizeSettings(settings);
  const days = (Array.isArray(raw?.days) ? raw.days : []).slice(0, safe.days).map((day) => {
    const meals = (Array.isArray(day.meals) ? day.meals : []).map((meal) => {
      const prepMinutes = Math.max(0, Math.round(safeNumber(meal.prepMinutes)));
      const cookMinutes = Math.max(0, Math.round(safeNumber(meal.cookMinutes)));
      return {
        id: randomUUID(),
        mealType: MEAL_TYPES.includes(meal.mealType) ? meal.mealType : 'meal',
        name: String(meal.name || 'Untitled meal'),
        calories: Math.max(0, Math.round(safeNumber(meal.calories))),
        servings: safe.servings,
        prepMinutes,
        cookMinutes,
        totalMinutes: prepMinutes + cookMinutes,
        ingredients: (Array.isArray(meal.ingredients) ? meal.ingredients : []).map((ingredient) => ({
          name: String(ingredient.name || '').trim(),
          amount: Math.max(0, safeNumber(ingredient.amount)),
          unit: String(ingredient.unit || 'item').trim(),
          notes: ingredient.notes == null ? null : String(ingredient.notes).trim()
        })).filter((ingredient) => ingredient.name && ingredient.amount > 0),
        instructions: (Array.isArray(meal.instructions) ? meal.instructions : []).map(String).filter(Boolean),
        chefNote: meal.chefNote == null ? null : String(meal.chefNote)
      };
    });

    return {
      date: String(day.date || ''),
      totalCalories: meals.reduce((sum, meal) => sum + meal.calories, 0),
      totalPrepMinutes: meals.reduce((sum, meal) => sum + meal.prepMinutes, 0),
      totalCookMinutes: meals.reduce((sum, meal) => sum + meal.cookMinutes, 0),
      meals
    };
  });

  return {
    id: randomUUID(),
    title: String(raw?.title || 'Meal Plan'),
    summary: String(raw?.summary || ''),
    targetCalories: safe.calorieTarget,
    servings: safe.servings,
    days,
    createdAt: new Date().toISOString()
  };
}

export function recalculatePlan(plan) {
  const copy = structuredClone(plan);
  copy.days = copy.days.map((day) => ({
    ...day,
    totalCalories: day.meals.reduce((sum, meal) => sum + safeNumber(meal.calories), 0),
    totalPrepMinutes: day.meals.reduce((sum, meal) => sum + safeNumber(meal.prepMinutes), 0),
    totalCookMinutes: day.meals.reduce((sum, meal) => sum + safeNumber(meal.cookMinutes), 0),
    meals: day.meals.map((meal) => ({
      ...meal,
      totalMinutes: safeNumber(meal.prepMinutes) + safeNumber(meal.cookMinutes)
    }))
  }));
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
