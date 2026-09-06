import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLocalMealPlan, getLocalAiStatus } from '../src/local-ai.js';

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('local AI status detects an installed model', async () => {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/api\/tags$/);
    return new Response(JSON.stringify({
      models: [{
        name: 'qwen3:4b-instruct',
        model: 'qwen3:4b-instruct',
        size: 2500000000,
        details: { parameter_size: '4B', quantization_level: 'Q4_K_M' }
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const status = await getLocalAiStatus('qwen3:4b-instruct');
  assert.equal(status.connected, true);
  assert.equal(status.installed, true);
  assert.equal(status.models[0].parameterSize, '4B');
});

test('local generator accepts structured Ollama output and marks the source local', async () => {
  const rawPlan = {
    title: 'Local Day',
    summary: 'A practical local plan.',
    targetCalories: 1000,
    servings: 1,
    days: [{
      date: '2026-09-06',
      meals: [{
        mealType: 'dinner',
        name: 'Chicken Rice Bowl',
        calories: 1000,
        servings: 1,
        prepMinutes: 10,
        cookMinutes: 15,
        ingredients: [
          { name: 'chicken breast', amount: 6, unit: 'oz', notes: null },
          { name: 'rice', amount: 1, unit: 'cup', notes: 'cooked' }
        ],
        instructions: ['Cook the chicken.', 'Serve it over the rice.'],
        chefNote: null
      }]
    }]
  };

  globalThis.fetch = async (url, options = {}) => {
    assert.match(String(url), /\/api\/chat$/);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'qwen3:4b-instruct');
    assert.equal(body.stream, false);
    assert.equal(body.think, false);
    assert.equal(body.format.type, 'object');
    return new Response(JSON.stringify({
      message: { role: 'assistant', content: JSON.stringify(rawPlan.days[0]) },
      prompt_eval_count: 100,
      eval_count: 200,
      total_duration: 1234
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const plan = await generateLocalMealPlan({
    calorieTarget: 1000,
    days: 1,
    servings: 1,
    mealTypes: ['dinner'],
    maxTotalMinutes: 30,
    aiModel: 'qwen3:4b-instruct'
  }, { startDate: '2026-09-06' });

  assert.equal(plan.source, 'local-ollama');
  assert.equal(plan.model, 'qwen3:4b-instruct');
  assert.equal(plan.days.length, 1);
  assert.equal(plan.days[0].totalCalories, 1000);
  assert.equal(plan.days[0].meals[0].totalMinutes, 25);
});

test('local generator repairs a meal that exceeds the configured time limit', async () => {
  let calls = 0;
  globalThis.fetch = async (url, options = {}) => {
    assert.match(String(url), /\/api\/chat$/);
    calls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.format.properties.meals.items.properties.prepMinutes.maximum, 40);
    assert.equal(body.format.properties.meals.items.properties.cookMinutes.maximum, 40);

    const meal = calls === 1
      ? {
          mealType: 'dinner', name: 'Slow Quinoa Bowl', calories: 1000, servings: 1,
          prepMinutes: 15, cookMinutes: 30,
          ingredients: [{ name: 'quinoa', amount: 1, unit: 'cup', notes: null }],
          instructions: ['Cook and serve.'], chefNote: null
        }
      : {
          mealType: 'dinner', name: 'Quick Couscous Bowl', calories: 1000, servings: 1,
          prepMinutes: 10, cookMinutes: 20,
          ingredients: [{ name: 'couscous', amount: 1, unit: 'cup', notes: null }],
          instructions: ['Cook and serve.'], chefNote: null
        };

    if (calls === 2) {
      const retryText = body.messages.map((m) => m.content).join('\n');
      assert.match(retryText, /15 min prep \+ 30 min cook = 45 minutes/);
      assert.match(retryText, /REPLACE that meal/);
    }

    return new Response(JSON.stringify({
      message: { role: 'assistant', content: JSON.stringify({ date: '2026-09-06', meals: [meal] }) },
      prompt_eval_count: 100,
      eval_count: 200,
      total_duration: 1234
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const plan = await generateLocalMealPlan({
    calorieTarget: 1000,
    days: 1,
    servings: 1,
    mealTypes: ['dinner'],
    maxTotalMinutes: 40,
    aiModel: 'qwen3:4b-instruct'
  }, { startDate: '2026-09-06' });

  assert.equal(calls, 2);
  assert.equal(plan.days[0].meals[0].name, 'Quick Couscous Bowl');
  assert.equal(plan.days[0].meals[0].totalMinutes, 30);
});

test('local generator repairs a day that misses the calorie target', async () => {
  let calls = 0;
  globalThis.fetch = async (url, options = {}) => {
    assert.match(String(url), /\/api\/chat$/);
    calls += 1;
    const body = JSON.parse(options.body);
    const promptText = body.messages.map((m) => m.content).join('\n');
    assert.match(promptText, /breakfast: about 417 calories/);
    assert.match(promptText, /dinner: about 583 calories/);

    const meals = calls === 1
      ? [
          {
            mealType: 'breakfast', name: 'Light Toast', calories: 150, servings: 1,
            prepMinutes: 5, cookMinutes: 0,
            ingredients: [{ name: 'whole grain bread', amount: 1, unit: 'slice', notes: null }],
            instructions: ['Toast and serve.'], chefNote: null
          },
          {
            mealType: 'dinner', name: 'Small Chicken Bowl', calories: 450, servings: 1,
            prepMinutes: 10, cookMinutes: 15,
            ingredients: [{ name: 'chicken breast', amount: 4, unit: 'oz', notes: null }],
            instructions: ['Cook and serve.'], chefNote: null
          }
        ]
      : [
          {
            mealType: 'breakfast', name: 'Egg Toast', calories: 417, servings: 1,
            prepMinutes: 5, cookMinutes: 5,
            ingredients: [
              { name: 'whole grain bread', amount: 1, unit: 'slice', notes: null },
              { name: 'egg', amount: 2, unit: 'item', notes: null }
            ],
            instructions: ['Cook eggs and serve with toast.'], chefNote: null
          },
          {
            mealType: 'dinner', name: 'Chicken Rice Bowl', calories: 583, servings: 1,
            prepMinutes: 10, cookMinutes: 15,
            ingredients: [
              { name: 'chicken breast', amount: 6, unit: 'oz', notes: null },
              { name: 'rice', amount: 1.5, unit: 'cup', notes: 'cooked' }
            ],
            instructions: ['Cook chicken and serve over rice.'], chefNote: null
          }
        ];

    if (calls === 2) {
      assert.match(promptText, /totals 600 calories/);
      assert.match(promptText, /ADD about 400 calories/);
      assert.match(promptText, /Do NOT fix calorie validation by changing calorie numbers alone/);
    }

    return new Response(JSON.stringify({
      message: { role: 'assistant', content: JSON.stringify({ date: '2026-09-06', meals }) },
      prompt_eval_count: 100,
      eval_count: 200,
      total_duration: 1234
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const plan = await generateLocalMealPlan({
    calorieTarget: 1000,
    days: 1,
    servings: 1,
    mealTypes: ['breakfast', 'dinner'],
    maxTotalMinutes: 40,
    aiModel: 'qwen3:4b-instruct'
  }, { startDate: '2026-09-06' });

  assert.equal(calls, 2);
  assert.equal(plan.days[0].totalCalories, 1000);
  assert.equal(plan.days[0].meals.length, 2);
});
