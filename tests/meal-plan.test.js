import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroceryList, sanitizeSettings, recalculatePlan } from '../src/meal-plan.js';

test('sanitizeSettings clamps unsafe values', () => {
  const settings = sanitizeSettings({ calorieTarget: 99, days: 100, servings: 0, maxTotalMinutes: -5, mealTypes: ['dinner', 'bogus'] });
  assert.equal(settings.calorieTarget, 800);
  assert.equal(settings.days, 14);
  assert.equal(settings.servings, 1);
  assert.equal(settings.maxTotalMinutes, 5);
  assert.deepEqual(settings.mealTypes, ['dinner']);
});

test('buildGroceryList combines same ingredient and unit', () => {
  const plan = {
    days: [
      { meals: [{ name: 'A', ingredients: [{ name: 'Chicken breast', amount: 8, unit: 'oz', notes: null }] }] },
      { meals: [{ name: 'B', ingredients: [{ name: 'chicken breast', amount: 4, unit: 'oz', notes: 'diced' }] }] }
    ]
  };
  const list = buildGroceryList(plan);
  assert.equal(list.length, 1);
  assert.equal(list[0].amount, 12);
  assert.deepEqual(list[0].usedIn.sort(), ['A', 'B']);
});

test('recalculatePlan recalculates calories and total minutes', () => {
  const plan = { days: [{ meals: [{ calories: 500, prepMinutes: 10, cookMinutes: 20 }, { calories: 600, prepMinutes: 5, cookMinutes: 15 }] }] };
  const updated = recalculatePlan(plan);
  assert.equal(updated.days[0].totalCalories, 1100);
  assert.equal(updated.days[0].totalPrepMinutes, 15);
  assert.equal(updated.days[0].totalCookMinutes, 35);
  assert.equal(updated.days[0].meals[0].totalMinutes, 30);
});
