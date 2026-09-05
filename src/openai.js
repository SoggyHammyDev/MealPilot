import { mealPlanSchema, mealSchema, normalizeGeneratedPlan, recalculatePlan, getMealById } from './meal-plan.js';

function extractOutputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text;
  for (const item of response?.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
      if (content.type === 'refusal') throw new Error(content.refusal || 'The model refused the request.');
    }
  }
  throw new Error('OpenAI returned no structured text output.');
}

async function callOpenAI({ apiKey, model, schema, schemaName, system, user }) {
  if (!apiKey) throw new Error('No OpenAI API key is configured. Open Settings and add one first.');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 24000,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: system }] },
        { role: 'user', content: [{ type: 'input_text', text: user }] }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          strict: true,
          schema
        }
      }
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `OpenAI request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  const text = extractOutputText(body);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`OpenAI returned invalid JSON: ${error.message}`);
  }
}

function generationPrompt(settings, startDate) {
  const mealTypes = settings.mealTypes.join(', ');
  return `Create a practical ${settings.days}-day meal plan beginning ${startDate}.

Requirements:
- Daily calorie target: approximately ${settings.calorieTarget} calories PER PERSON. Aim within ±5% each day.
- Meals each day: ${mealTypes}. Include exactly one of each requested meal type per day.
- Household servings to prepare: ${settings.servings}. Ingredient amounts must already be scaled to make ${settings.servings} serving(s).
- The calories field for each meal is PER SERVING, not multiplied by household size.
- Dietary style: ${settings.dietaryStyle || 'No preference'}.
- Allergies / hard exclusions: ${settings.allergies || 'None provided'}.
- Foods to avoid or dislike: ${settings.avoidFoods || 'None provided'}.
- Pantry ingredients to prioritize where sensible: ${settings.pantry || 'None provided'}.
- Maximum total prep + cook time for a normal meal: ${settings.maxTotalMinutes} minutes. Snacks may be faster.
- Grocery budget guidance: ${settings.budget || 'No specific budget'}.
- Additional instructions: ${settings.customInstructions || 'None'}.

Quality rules:
- Use realistic ingredient quantities and common grocery-store units.
- Avoid tiny impractical measurements when a normal kitchen measurement works.
- Prefer reuse of ingredients across the week to reduce waste.
- Keep instructions concise but complete enough to cook the meal.
- Prep and cook times must be realistic.
- Do not make medical or therapeutic claims.
- Respect allergies as hard constraints.
- Dates must be consecutive ISO dates starting with ${startDate}.`;
}

export async function generatePlanWithAI(settings, startDate, apiKey) {
  const raw = await callOpenAI({
    apiKey,
    model: settings.model,
    schema: mealPlanSchema,
    schemaName: 'meal_plan',
    system: 'You are MealPilot, a careful meal-planning assistant. Return only data that matches the supplied JSON schema.',
    user: generationPrompt(settings, startDate)
  });
  return normalizeGeneratedPlan(raw, settings);
}

export async function replaceMealWithAI({ plan, mealId, notes, settings, apiKey }) {
  const found = getMealById(plan, mealId);
  if (!found) throw new Error('Meal not found.');

  const otherCalories = found.day.meals
    .filter((meal) => meal.id !== mealId)
    .reduce((sum, meal) => sum + meal.calories, 0);
  const desiredCalories = Math.max(100, plan.targetCalories - otherCalories);

  const raw = await callOpenAI({
    apiKey,
    model: settings.model,
    schema: mealSchema,
    schemaName: 'replacement_meal',
    system: 'You are MealPilot. Create one replacement meal and return only data matching the JSON schema.',
    user: `Replace this ${found.meal.mealType} on ${found.day.date}: "${found.meal.name}".
Target about ${desiredCalories} calories per serving so the day remains near ${plan.targetCalories} calories.
Prepare ${plan.servings} serving(s); ingredient amounts must be scaled for that many servings.
Dietary style: ${settings.dietaryStyle}.
Allergies / hard exclusions: ${settings.allergies || 'None'}.
Avoid: ${settings.avoidFoods || 'None'}.
Maximum total prep + cook time: ${settings.maxTotalMinutes} minutes.
User replacement request: ${notes || 'Give me a different meal with similar calories and cooking effort.'}`
  });

  const prepMinutes = Math.max(0, Math.round(Number(raw.prepMinutes) || 0));
  const cookMinutes = Math.max(0, Math.round(Number(raw.cookMinutes) || 0));
  const replacement = {
    ...raw,
    id: found.meal.id,
    servings: plan.servings,
    calories: Math.max(0, Math.round(Number(raw.calories) || 0)),
    prepMinutes,
    cookMinutes,
    totalMinutes: prepMinutes + cookMinutes,
    ingredients: raw.ingredients.map((x) => ({ ...x, amount: Number(x.amount) })),
    replacedAt: new Date().toISOString()
  };

  const updated = structuredClone(plan);
  const targetDay = updated.days.find((day) => day.date === found.day.date);
  targetDay.meals = targetDay.meals.map((meal) => meal.id === mealId ? replacement : meal);
  return recalculatePlan(updated);
}

export async function testOpenAI(apiKey, model) {
  if (!apiKey) throw new Error('No OpenAI API key is configured.');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 20,
      input: 'Reply with exactly: MealPilot connected'
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `OpenAI request failed with HTTP ${response.status}.`);
  return extractOutputText(body).trim();
}
