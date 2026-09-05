const state = {
  settings: null,
  currentPlan: null,
  replaceMealId: null,
  replacePlanId: null,
  toastTimer: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

function setMessage(node, message, type = 'success') {
  node.textContent = message;
  node.className = `message ${type}`;
}

function clearMessage(node) {
  node.textContent = '';
  node.className = 'message hidden';
}

function fmtNumber(value) {
  return new Intl.NumberFormat().format(Math.round(Number(value) || 0));
}

function fmtAmount(value) {
  const n = Number(value) || 0;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatDay(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  if (!y || !m || !d) return dateString;
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

function localIsoToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showView(name) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  $$('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.viewLink === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'plans') loadPlans();
  if (name === 'settings') loadMcpConfig();
}

function fillGenerator(settings) {
  $('#calorieTarget').value = settings.calorieTarget;
  $('#days').value = settings.days;
  $('#servings').value = settings.servings;
  $('#maxTotalMinutes').value = settings.maxTotalMinutes;
  $('#dietaryStyle').value = settings.dietaryStyle;
  $('#allergies').value = settings.allergies;
  $('#avoidFoods').value = settings.avoidFoods;
  $('#pantry').value = settings.pantry;
  $('#budget').value = settings.budget;
  $('#customInstructions').value = settings.customInstructions;
  $('#startDate').value = localIsoToday();
  $$('input[name="mealTypes"]').forEach((checkbox) => {
    checkbox.checked = settings.mealTypes.includes(checkbox.value);
  });
  updateHeroStats();
}

function updateHeroStats() {
  $('#heroDays').textContent = `${$('#days').value || 0} days`;
  $('#heroCalories').textContent = `${fmtNumber($('#calorieTarget').value)} cal`;
  $('#heroTime').textContent = `${$('#maxTotalMinutes').value || 0} min`;
}

function generatorPayload() {
  const mealTypes = $$('input[name="mealTypes"]:checked').map((input) => input.value);
  if (!mealTypes.length) throw new Error('Choose at least one meal type.');
  return {
    calorieTarget: Number($('#calorieTarget').value),
    days: Number($('#days').value),
    servings: Number($('#servings').value),
    startDate: $('#startDate').value,
    maxTotalMinutes: Number($('#maxTotalMinutes').value),
    mealTypes,
    dietaryStyle: $('#dietaryStyle').value,
    allergies: $('#allergies').value.trim(),
    avoidFoods: $('#avoidFoods').value.trim(),
    pantry: $('#pantry').value.trim(),
    budget: $('#budget').value.trim(),
    customInstructions: $('#customInstructions').value.trim()
  };
}

function renderMeal(meal, planId) {
  const ingredients = meal.ingredients.map((item) => `
    <li><strong>${escapeHtml(fmtAmount(item.amount))} ${escapeHtml(item.unit)}</strong> ${escapeHtml(item.name)}${item.notes ? ` <span class="muted">(${escapeHtml(item.notes)})</span>` : ''}</li>
  `).join('');
  const instructions = meal.instructions.map((step) => `<li>${escapeHtml(step)}</li>`).join('');
  return `
    <article class="meal-card">
      <div class="meal-top">
        <div>
          <span class="meal-type">${escapeHtml(meal.mealType)}</span>
          <h3>${escapeHtml(meal.name)}</h3>
        </div>
        <span class="calorie-badge">${fmtNumber(meal.calories)} cal</span>
      </div>
      <div class="time-row"><span>${meal.prepMinutes} min prep</span><span>${meal.cookMinutes} min cook</span><span>${meal.totalMinutes} min total</span></div>
      <details><summary>Ingredients · ${meal.servings} serving${meal.servings === 1 ? '' : 's'}</summary><ul class="ingredient-list">${ingredients}</ul></details>
      <details><summary>Cooking instructions</summary><ol class="instruction-list">${instructions}</ol>${meal.chefNote ? `<p class="fine-print">${escapeHtml(meal.chefNote)}</p>` : ''}</details>
      <div class="meal-actions"><button class="text-btn replace-meal-btn" type="button" data-plan-id="${escapeHtml(planId)}" data-meal-id="${escapeHtml(meal.id)}" data-meal-name="${escapeHtml(meal.name)}">↻ Replace this meal</button></div>
    </article>
  `;
}

function renderPlan(plan) {
  state.currentPlan = plan;
  const target = Number(plan.targetCalories) || 0;
  const days = plan.days.map((day) => {
    const delta = target ? Math.round(((day.totalCalories - target) / target) * 100) : 0;
    const deltaText = delta === 0 ? 'on target' : `${delta > 0 ? '+' : ''}${delta}% vs target`;
    return `
      <section class="day-card">
        <div class="day-header">
          <div class="day-title"><strong>${escapeHtml(formatDay(day.date))}</strong><span>${escapeHtml(day.date)}</span></div>
          <div class="day-metrics">
            <div><strong>${fmtNumber(day.totalCalories)}</strong><span>Calories · ${escapeHtml(deltaText)}</span></div>
            <div><strong>${day.totalPrepMinutes + day.totalCookMinutes} min</strong><span>Total kitchen time</span></div>
          </div>
        </div>
        <div class="meals-grid">${day.meals.map((meal) => renderMeal(meal, plan.id)).join('')}</div>
      </section>`;
  }).join('');

  const root = $('#planResult');
  root.innerHTML = `
    <div class="result-header">
      <div><p class="eyebrow">YOUR PLAN</p><h2>${escapeHtml(plan.title)}</h2><p class="summary-text">${escapeHtml(plan.summary)}</p></div>
      <div class="button-row"><button id="groceryBtn" class="primary-btn" type="button">Grocery list</button><button id="savedPlansBtn" class="ghost-btn" type="button">Saved plans</button></div>
    </div>
    <div class="days-grid">${days}</div>
    <section id="groceryPanel" class="panel grocery-panel hidden"></section>
  `;
  root.classList.remove('hidden');
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });

  $('#groceryBtn').addEventListener('click', () => loadGrocery(plan.id));
  $('#savedPlansBtn').addEventListener('click', () => showView('plans'));
  $$('.replace-meal-btn', root).forEach((button) => button.addEventListener('click', () => openReplaceModal(button.dataset)));
}

async function loadGrocery(planId) {
  const button = $('#groceryBtn');
  const panel = $('#groceryPanel');
  button.disabled = true;
  button.textContent = 'Building list…';
  try {
    const list = await api(`/api/plans/${encodeURIComponent(planId)}/grocery-list`);
    panel.innerHTML = `
      <div class="panel-heading"><div><p class="eyebrow">COMBINED LIST</p><h2>Grocery list</h2></div><span class="status-pill good">${list.length} items</span></div>
      <div class="grocery-grid">${list.map((item) => `<div class="grocery-item"><strong>${escapeHtml(fmtAmount(item.amount))} ${escapeHtml(item.unit)}</strong> · ${escapeHtml(item.name)}${item.notes.length ? `<br><span class="fine-print">${escapeHtml(item.notes.join('; '))}</span>` : ''}</div>`).join('')}</div>`;
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Grocery list';
  }
}

async function loadPlans() {
  const root = $('#plansList');
  root.innerHTML = '<div class="empty-state">Loading saved plans…</div>';
  try {
    const plans = await api('/api/plans?limit=100');
    if (!plans.length) {
      root.innerHTML = '<div class="empty-state">No plans yet. Generate your first meal plan to start the library.</div>';
      return;
    }
    root.innerHTML = plans.map((plan) => `
      <article class="plan-row">
        <div><h3>${escapeHtml(plan.title)}</h3><p>Created ${escapeHtml(new Date(plan.createdAt).toLocaleString())}</p></div>
        <div class="meta"><span>${fmtNumber(plan.targetCalories)} cal/day</span><span>·</span><span>${plan.servings} serving${plan.servings === 1 ? '' : 's'}</span></div>
        <div class="button-row"><button type="button" class="ghost-btn open-plan" data-plan-id="${escapeHtml(plan.id)}">Open</button><button type="button" class="danger-text-btn delete-plan" data-plan-id="${escapeHtml(plan.id)}">Delete</button></div>
      </article>`).join('');
    $$('.open-plan', root).forEach((button) => button.addEventListener('click', async () => {
      try {
        const plan = await api(`/api/plans/${encodeURIComponent(button.dataset.planId)}`);
        showView('generate');
        renderPlan(plan);
      } catch (error) { toast(error.message); }
    }));
    $$('.delete-plan', root).forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Delete this saved meal plan?')) return;
      try {
        await api(`/api/plans/${encodeURIComponent(button.dataset.planId)}`, { method: 'DELETE' });
        toast('Plan deleted');
        loadPlans();
      } catch (error) { toast(error.message); }
    }));
  } catch (error) {
    root.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function openReplaceModal({ planId, mealId, mealName }) {
  state.replacePlanId = planId;
  state.replaceMealId = mealId;
  $('#replaceMealName').textContent = mealName;
  $('#replaceNotes').value = '';
  clearMessage($('#replaceError'));
  $('#modalBackdrop').classList.remove('hidden');
  $('#modalBackdrop').setAttribute('aria-hidden', 'false');
  $('#replaceNotes').focus();
}

function closeReplaceModal() {
  $('#modalBackdrop').classList.add('hidden');
  $('#modalBackdrop').setAttribute('aria-hidden', 'true');
  state.replacePlanId = null;
  state.replaceMealId = null;
}

async function confirmReplace() {
  const button = $('#confirmReplaceBtn');
  clearMessage($('#replaceError'));
  button.disabled = true;
  button.textContent = 'Replacing…';
  try {
    const plan = await api(`/api/plans/${encodeURIComponent(state.replacePlanId)}/meals/${encodeURIComponent(state.replaceMealId)}/replace`, {
      method: 'POST',
      body: JSON.stringify({ notes: $('#replaceNotes').value.trim() })
    });
    closeReplaceModal();
    renderPlan(plan);
    toast('Meal replaced');
  } catch (error) {
    setMessage($('#replaceError'), error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Replace meal';
  }
}

async function loadMcpConfig() {
  try {
    const config = await api('/api/mcp-config');
    $('#mcpEndpoint').value = config.endpoint;
    $('#mcpToken').value = config.token;
  } catch (error) {
    toast(error.message);
  }
}

async function init() {
  try {
    state.settings = await api('/api/settings');
    fillGenerator(state.settings);
    $('#settingsModel').value = state.settings.model;
    updateConnectionUi(state.settings);
  } catch (error) {
    $('#connectionPill').textContent = 'Setup error';
    $('#connectionPill').className = 'status-pill bad';
    setMessage($('#generateError'), error.message, 'error');
  }
}

function updateConnectionUi(settings) {
  const pill = $('#connectionPill');
  const badge = $('#apiKeyBadge');
  if (settings.hasApiKey) {
    pill.textContent = 'OpenAI ready';
    pill.className = 'status-pill good';
    badge.textContent = settings.apiKeySource === 'environment' ? 'Environment key' : 'Key stored';
    badge.className = 'status-pill good';
  } else {
    pill.textContent = 'API key needed';
    pill.className = 'status-pill bad';
    badge.textContent = 'Not configured';
    badge.className = 'status-pill bad';
  }
}

$$('[data-view-link]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.viewLink)));
['calorieTarget', 'days', 'maxTotalMinutes'].forEach((id) => $(`#${id}`).addEventListener('input', updateHeroStats));

$('#resetFormBtn').addEventListener('click', () => {
  if (state.settings) fillGenerator(state.settings);
});

$('#generatorForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#generateBtn');
  clearMessage($('#generateError'));
  try {
    const payload = generatorPayload();
    button.disabled = true;
    button.innerHTML = '<span class="spark">✦</span> Planning your meals…';
    const plan = await api('/api/generate', { method: 'POST', body: JSON.stringify(payload) });
    renderPlan(plan);
    toast('Meal plan generated and saved');
  } catch (error) {
    setMessage($('#generateError'), error.message, 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = '<span class="spark">✦</span> Generate meal plan';
  }
});

$('#settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('#settingsMessage');
  clearMessage(message);
  try {
    const model = $('#settingsModel').value;
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ model }) });
    const key = $('#openaiApiKey').value.trim();
    if (key) {
      await api('/api/settings/openai-key', { method: 'PUT', body: JSON.stringify({ apiKey: key }) });
      $('#openaiApiKey').value = '';
    }
    state.settings = await api('/api/settings');
    updateConnectionUi(state.settings);
    setMessage(message, 'Settings saved.', 'success');
  } catch (error) {
    setMessage(message, error.message, 'error');
  }
});

$('#testOpenAiBtn').addEventListener('click', async () => {
  const button = $('#testOpenAiBtn');
  const message = $('#settingsMessage');
  clearMessage(message);
  button.disabled = true;
  button.textContent = 'Testing…';
  try {
    const result = await api('/api/settings/test-openai', { method: 'POST' });
    setMessage(message, result.message || 'OpenAI connection works.', 'success');
  } catch (error) {
    setMessage(message, error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Test connection';
  }
});

$('#removeKeyBtn').addEventListener('click', async () => {
  if (!window.confirm('Remove the API key stored in MealPilot? Environment keys cannot be removed from here.')) return;
  try {
    state.settings = await api('/api/settings/openai-key', { method: 'DELETE' });
    updateConnectionUi(state.settings);
    setMessage($('#settingsMessage'), 'Stored API key removed.', 'success');
  } catch (error) {
    setMessage($('#settingsMessage'), error.message, 'error');
  }
});

$$('[data-copy-target]').forEach((button) => button.addEventListener('click', async () => {
  const input = $(`#${button.dataset.copyTarget}`);
  try {
    await navigator.clipboard.writeText(input.value);
    toast('Copied');
  } catch {
    input.select();
    document.execCommand('copy');
    toast('Copied');
  }
}));

$('#toggleTokenBtn').addEventListener('click', () => {
  const input = $('#mcpToken');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('#toggleTokenBtn').textContent = show ? 'Hide token' : 'Show token';
});

$('#rotateTokenBtn').addEventListener('click', async () => {
  if (!window.confirm('Rotate the MCP bearer token? Existing MCP clients will stop working until updated.')) return;
  try {
    const result = await api('/api/mcp-config/rotate-token', { method: 'POST' });
    $('#mcpToken').value = result.token;
    toast('MCP token rotated');
  } catch (error) { toast(error.message); }
});

$('#closeModalBtn').addEventListener('click', closeReplaceModal);
$('#cancelReplaceBtn').addEventListener('click', closeReplaceModal);
$('#confirmReplaceBtn').addEventListener('click', confirmReplace);
$('#modalBackdrop').addEventListener('click', (event) => {
  if (event.target === $('#modalBackdrop')) closeReplaceModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#modalBackdrop').classList.contains('hidden')) closeReplaceModal();
});

init();
