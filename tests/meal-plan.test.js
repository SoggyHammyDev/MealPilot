import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGenerationPrompt,
  buildGroceryList,
  normalizeExternalPlan,
  parsePlanText,
  recalculatePlan,
  replaceMealWithData,
  sanitizeSettings
} from '../src/meal-plan.js';

test('sanitizeSettings clamps values and no longer carries a model setting', () => {
  const result = sanitizeSettings({ calorieTarget: 99999, days: 0, servings: 99, maxTotalMinutes: 1, model: 'gpt-anything' });
  assert.equal(result.calorieTarget, 8000);
  assert.equal(result.days, 1);
  assert.equal(result.servings, 20);
  assert.equal(result.maxTotalMinutes, 5);
  assert.equal('model' in result, false);
});

test('grocery list merges same ingredient/unit', () => {
  const plan = {
    days: [{ meals: [
      { name: 'A', ingredients: [{ name: 'Rice', amount: 1, unit: 'cup', notes: null }] },
      { name: 'B', ingredients: [{ name: 'rice', amount: 1.5, unit: 'cup', notes: 'dry' }] }
    ] }]
  };
  const list = buildGroceryList(plan);
  assert.equal(list.length, 1);
  assert.equal(list[0].amount, 2.5);
  assert.deepEqual(list[0].usedIn, ['A', 'B']);
});

test('normalizes imported plans and recalculates daily totals', () => {
  const raw = {
    title: 'Test week', summary: 'Test', targetCalories: 1800, servings: 2,
    days: [{ date: '2026-09-07', meals: [{
      mealType: 'dinner', name: 'Rice Bowl', calories: 600, servings: 2,
      prepMinutes: 10, cookMinutes: 20,
      ingredients: [{ name: 'Rice', amount: 2, unit: 'cup', notes: null }],
      instructions: ['Cook it.'], chefNote: null
    }] }]
  };
  const plan = normalizeExternalPlan(raw);
  assert.ok(plan.id);
  assert.ok(plan.days[0].meals[0].id);
  assert.equal(plan.targetCalories, 1800);
  assert.equal(plan.servings, 2);
  assert.equal(plan.days[0].totalCalories, 600);
  assert.equal(plan.days[0].meals[0].totalMinutes, 30);
  assert.equal(plan.source, 'external-ai');
});

test('replacement preserves meal ID and recalculates totals', () => {
  const raw = {
    title: 'Test', summary: '', targetCalories: 2000, servings: 1,
    days: [{ date: '2026-09-07', meals: [{
      mealType: 'dinner', name: 'Old', calories: 500, servings: 1,
      prepMinutes: 5, cookMinutes: 10,
      ingredients: [{ name: 'Rice', amount: 1, unit: 'cup', notes: null }],
      instructions: ['Cook.'], chefNote: null
    }] }]
  };
  const plan = normalizeExternalPlan(raw);
  const mealId = plan.days[0].meals[0].id;
  const updated = replaceMealWithData(plan, mealId, {
    mealType: 'dinner', name: 'New', calories: 650, servings: 1,
    prepMinutes: 7, cookMinutes: 13,
    ingredients: [{ name: 'Pasta', amount: 4, unit: 'oz', notes: null }],
    instructions: ['Boil.'], chefNote: null
  });
  assert.equal(updated.days[0].meals[0].id, mealId);
  assert.equal(updated.days[0].meals[0].name, 'New');
  assert.equal(updated.days[0].totalCalories, 650);
  assert.equal(updated.days[0].meals[0].totalMinutes, 20);
});

test('prompt contains preferences and no API-key dependency', () => {
  const prompt = buildGenerationPrompt({
    calorieTarget: 2100,
    days: 3,
    servings: 2,
    pantry: 'chicken, rice',
    allergies: 'peanuts'
  }, { startDate: '2026-09-10' });
  assert.match(prompt, /2100/);
  assert.match(prompt, /chicken, rice/);
  assert.match(prompt, /peanuts/);
  assert.match(prompt, /2026-09-10/);
  assert.doesNotMatch(prompt, /OpenAI API key/i);
});

test('manual importer accepts markdown JSON fences', () => {
  const parsed = parsePlanText('```json\n{"title":"A","days":[]}\n```');
  assert.equal(parsed.title, 'A');
});

test('recalculatePlan remains backward compatible with saved plans', () => {
  const plan = { days: [{ meals: [{ calories: 100, prepMinutes: 2, cookMinutes: 3 }] }] };
  const result = recalculatePlan(plan);
  assert.equal(result.days[0].totalCalories, 100);
  assert.equal(result.days[0].meals[0].totalMinutes, 5);
});
