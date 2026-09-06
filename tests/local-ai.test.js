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
