const state = {
  settings: null,
  currentPlan: null,
  prompt: '',
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
  const [y, m, d] = String(dateString).split('-').map(Number);
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

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'absolute';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('Copy failed. Select the text manually instead.');
}

function showView(name) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  $$('[data-view-link]').forEach((button) => button.classList.toggle('active', button.dataset.viewLink === name));
  if (name === 'plans') void loadPlans();
  if (name === 'mcp') void loadMcpConfig();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function syncHero() {
  if (!state.settings) return;
  $('#heroDays').textContent = `${state.settings.days} day${state.settings.days === 1 ? '' : 's'}`;
  $('#heroCalories').textContent = `${fmtNumber(state.settings.calorieTarget)} cal`;
  $('#heroTime').textContent = `${state.settings.maxTotalMinutes} min`;
}

function fillPreferences(settings) {
  $('#calorieTarget').value = settings.calorieTarget;
  $('#days').value = settings.days;
  $('#servings').value = settings.servings;
  $('#dietaryStyle').value = settings.dietaryStyle;
  $('#allergies').value = settings.allergies;
  $('#avoidFoods').value = settings.avoidFoods;
  $('#pantry').value = settings.pantry;
  $('#maxTotalMinutes').value = settings.maxTotalMinutes;
  $('#budget').value = settings.budget;
  $('#customInstructions').value = settings.customInstructions;
  $$('input[name="mealTypes"]').forEach((input) => { input.checked = settings.mealTypes.includes(input.value); });
}

function readPreferencesForm() {
  return {
    calorieTarget: Number($('#calorieTarget').value),
    days: Number($('#days').value),
    servings: Number($('#servings').value),
    dietaryStyle: $('#dietaryStyle').value,
    allergies: $('#allergies').value.trim(),
    avoidFoods: $('#avoidFoods').value.trim(),
    pantry: $('#pantry').value.trim(),
    maxTotalMinutes: Number($('#maxTotalMinutes').value),
    budget: $('#budget').value.trim(),
    customInstructions: $('#customInstructions').value.trim(),
    mealTypes: $$('input[name="mealTypes"]:checked').map((input) => input.value)
  };
}

function mealHtml(meal) {
  const ingredients = (meal.ingredients || []).map((item) => `
    <li><strong>${escapeHtml(fmtAmount(item.amount))} ${escapeHtml(item.unit)}</strong> ${escapeHtml(item.name)}${item.notes ? ` <span>(${escapeHtml(item.notes)})</span>` : ''}</li>`).join('');
  const instructions = (meal.instructions || []).map((step) => `<li>${escapeHtml(step)}</li>`).join('');
  return `
    <article class="meal-card">
      <div class="meal-top">
        <div><span class="meal-type">${escapeHtml(meal.mealType)}</span><h3>${escapeHtml(meal.name)}</h3></div>
        <span class="calorie-badge">${fmtNumber(meal.calories)} cal</span>
      </div>
      <div class="time-row"><span>Prep ${fmtNumber(meal.prepMinutes)}m</span><span>Cook ${fmtNumber(meal.cookMinutes)}m</span><span>Total ${fmtNumber(meal.totalMinutes)}m</span></div>
      ${meal.chefNote ? `<p class="muted chef-note">${escapeHtml(meal.chefNote)}</p>` : ''}
      <details><summary>Ingredients</summary><ul class="ingredient-list">${ingredients}</ul></details>
      <details><summary>Instructions</summary><ol class="instruction-list">${instructions}</ol></details>
    </article>`;
}

async function renderPlan(plan, root = $('#planResult')) {
  state.currentPlan = plan;
  root.classList.remove('hidden');
  const days = (plan.days || []).map((day) => `
    <section class="day-card">
      <header class="day-header">
        <div class="day-title"><strong>${escapeHtml(formatDay(day.date))}</strong><span>${escapeHtml(day.date)}</span></div>
        <div class="day-metrics">
          <div><strong>${fmtNumber(day.totalCalories)}</strong><span>calories</span></div>
          <div><strong>${fmtNumber(day.totalPrepMinutes + day.totalCookMinutes)}m</strong><span>kitchen time</span></div>
        </div>
      </header>
      <div class="meals-grid">${(day.meals || []).map(mealHtml).join('')}</div>
    </section>`).join('');

  root.innerHTML = `
    <div class="result-header">
      <div><p class="eyebrow">SAVED TO UMBREL</p><h2>${escapeHtml(plan.title)}</h2><p class="summary-text">${escapeHtml(plan.summary || '')}</p></div>
      <div class="button-row"><button id="showGroceriesBtn" class="ghost-btn" type="button">Grocery list</button></div>
    </div>
    <div class="days-grid">${days}</div>
    <section id="groceryPanel" class="panel grocery-panel hidden"></section>`;

  $('#showGroceriesBtn', root)?.addEventListener('click', async () => {
    const button = $('#showGroceriesBtn', root);
    button.disabled = true;
    try {
      const items = await api(`/api/plans/${encodeURIComponent(plan.id)}/grocery-list`);
      const panel = $('#groceryPanel', root);
      panel.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">SHOPPING</p><h2>Combined grocery list</h2></div></div><div class="grocery-grid">${items.map((item) => `<div class="grocery-item"><strong>${escapeHtml(fmtAmount(item.amount))} ${escapeHtml(item.unit)}</strong> ${escapeHtml(item.name)}</div>`).join('')}</div>`;
      panel.classList.remove('hidden');
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

async function loadPlans() {
  const root = $('#plansList');
  root.innerHTML = '<div class="empty-state">Loading plans…</div>';
  try {
    const plans = await api('/api/plans?limit=100');
    if (!plans.length) {
      root.innerHTML = '<div class="empty-state">No plans yet. Use MCP or import your first AI-generated plan.</div>';
      return;
    }
    root.innerHTML = plans.map((plan) => `
      <article class="plan-row">
        <div><h3>${escapeHtml(plan.title)}</h3><p>${new Date(plan.createdAt).toLocaleString()}</p></div>
        <div class="meta"><span>${fmtNumber(plan.targetCalories)} cal</span><span>·</span><span>${fmtNumber(plan.servings)} serving${plan.servings === 1 ? '' : 's'}</span></div>
        <div class="button-row"><button class="ghost-btn small open-plan" data-plan-id="${escapeHtml(plan.id)}" type="button">Open</button><button class="danger-text-btn delete-plan" data-plan-id="${escapeHtml(plan.id)}" type="button">Delete</button></div>
      </article>`).join('');

    $$('.open-plan', root).forEach((button) => button.addEventListener('click', async () => {
      try {
        const plan = await api(`/api/plans/${encodeURIComponent(button.dataset.planId)}`);
        showView('home');
        await renderPlan(plan);
        $('#planResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) { toast(error.message); }
    }));

    $$('.delete-plan', root).forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Delete this saved meal plan?')) return;
      try {
        await api(`/api/plans/${encodeURIComponent(button.dataset.planId)}`, { method: 'DELETE' });
        toast('Plan deleted');
        await loadPlans();
      } catch (error) { toast(error.message); }
    }));
  } catch (error) {
    root.innerHTML = `<div class="message error">${escapeHtml(error.message)}</div>`;
  }
}

async function loadSettings() {
  try {
    state.settings = await api('/api/settings');
    fillPreferences(state.settings);
    syncHero();
    $('#connectionPill').textContent = 'Umbrel ready';
    $('#connectionPill').className = 'status-pill good';
  } catch (error) {
    $('#connectionPill').textContent = 'Connection error';
    $('#connectionPill').className = 'status-pill bad';
    setMessage($('#preferencesMessage'), error.message, 'error');
  }
}

async function loadMcpConfig() {
  try {
    const config = await api('/api/mcp-config');
    $('#mcpEndpoint').value = config.endpoint;
    if (config.authMode === 'none') {
      $('#tokenSection').classList.add('hidden');
      const notice = $('#noAuthNotice');
      notice.textContent = config.note;
      notice.className = 'message error';
    } else {
      $('#tokenSection').classList.remove('hidden');
      $('#noAuthNotice').classList.add('hidden');
      $('#mcpToken').value = config.token || '';
    }
  } catch (error) {
    toast(error.message);
  }
}

$('#preferencesForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#savePreferencesBtn');
  clearMessage($('#preferencesMessage'));
  button.disabled = true;
  try {
    const payload = readPreferencesForm();
    if (!payload.mealTypes.length) throw new Error('Choose at least one meal type.');
    state.settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
    fillPreferences(state.settings);
    syncHero();
    setMessage($('#preferencesMessage'), 'Preferences saved. MCP clients will see these values on their next read.', 'success');
  } catch (error) {
    setMessage($('#preferencesMessage'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#resetPreferencesBtn').addEventListener('click', () => {
  if (state.settings) fillPreferences(state.settings);
  toast('Reloaded saved preferences');
});

$('#buildPromptBtn').addEventListener('click', async () => {
  const button = $('#buildPromptBtn');
  clearMessage($('#promptMessage'));
  button.disabled = true;
  try {
    const result = await api('/api/generation-prompt', {
      method: 'POST',
      body: JSON.stringify({ startDate: $('#promptStartDate').value })
    });
    state.prompt = result.prompt;
    if ($('#promptMode').value === 'short') {
      state.prompt = `Use the following MealPilot constraints to create my meal plan. Return only valid JSON exactly as requested so I can import it into MealPilot.\n\n${state.prompt}`;
    }
    $('#promptPreview').value = state.prompt;
    $('#promptPreviewWrap').classList.remove('hidden');
    $('#copyPromptBtn').disabled = false;
    setMessage($('#promptMessage'), 'Prompt ready. Paste it into ChatGPT or another AI client.', 'success');
  } catch (error) {
    setMessage($('#promptMessage'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#copyPromptBtn').addEventListener('click', async () => {
  try {
    await copyText(state.prompt || $('#promptPreview').value);
    toast('Prompt copied');
  } catch (error) { toast(error.message); }
});

$('#importBtn').addEventListener('click', async () => {
  const button = $('#importBtn');
  clearMessage($('#importMessage'));
  button.disabled = true;
  try {
    const plan = await api('/api/plans/import', {
      method: 'POST',
      body: JSON.stringify({ text: $('#importText').value })
    });
    await renderPlan(plan);
    $('#importText').value = '';
    setMessage($('#importMessage'), 'Plan imported and saved.', 'success');
    toast('Meal plan saved');
    $('#planResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    setMessage($('#importMessage'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#clearImportBtn').addEventListener('click', () => {
  $('#importText').value = '';
  clearMessage($('#importMessage'));
});

$$('[data-copy-target]').forEach((button) => button.addEventListener('click', async () => {
  const input = document.getElementById(button.dataset.copyTarget);
  try { await copyText(input.value); toast('Copied'); } catch (error) { toast(error.message); }
}));

$('#toggleTokenBtn').addEventListener('click', () => {
  const input = $('#mcpToken');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('#toggleTokenBtn').textContent = input.type === 'password' ? 'Show token' : 'Hide token';
});

$('#rotateTokenBtn').addEventListener('click', async () => {
  if (!window.confirm('Rotate the MCP bearer token? Existing clients will stop working until you update them.')) return;
  try {
    const result = await api('/api/mcp-config/rotate-token', { method: 'POST' });
    $('#mcpToken').value = result.token;
    toast('MCP token rotated');
  } catch (error) { toast(error.message); }
});

$$('[data-view-link]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.viewLink)));

$('#promptStartDate').value = localIsoToday();
void loadSettings();
