import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  deletePlan,
  getPlan,
  getSettings,
  listPlans,
  savePlan,
  updateSettings
} from './db.js';
import {
  buildGenerationPrompt,
  buildGroceryList,
  normalizeExternalPlan,
  parsePlanText,
  replaceMealWithData,
  sanitizeSettings
} from './meal-plan.js';
import {
  getGenerationJob,
  getLocalAiStatus,
  getModelPullState,
  startGenerationJob,
  startModelPull
} from './local-ai.js';
import {
  closeMcp,
  getMcpAuthMode,
  getMcpToken,
  mcpNodeHandler,
  requireMcpAuth,
  rotateMcpToken,
  validateMcpOrigin
} from './mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const app = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: '0.3.0', mode: 'local-ai+mcp', apiKeyRequired: false });
});

app.get('/api/settings', (_req, res) => res.json(getSettings()));

app.put('/api/settings', (req, res, next) => {
  try {
    res.json(updateSettings(req.body || {}));
  } catch (error) { next(error); }
});

app.post('/api/generation-prompt', (req, res, next) => {
  try {
    const stored = getSettings();
    const settings = sanitizeSettings(req.body?.overrides || {}, stored);
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.startDate || '') ? req.body.startDate : undefined;
    res.json({ prompt: buildGenerationPrompt(settings, { startDate }) });
  } catch (error) { next(error); }
});


app.get('/api/ai/status', async (req, res, next) => {
  try {
    const settings = getSettings();
    res.json(await getLocalAiStatus(req.query.model || settings.aiModel));
  } catch (error) { next(error); }
});

app.post('/api/ai/pull', (req, res, next) => {
  try {
    const settings = getSettings();
    const model = req.body?.model || settings.aiModel;
    res.status(202).json({ model, pull: startModelPull(model) });
  } catch (error) { next(error); }
});

app.get('/api/ai/pull', (req, res) => {
  const settings = getSettings();
  const model = req.query.model || settings.aiModel;
  res.json({ model, pull: getModelPullState(model) });
});

app.post('/api/generate', async (req, res, next) => {
  try {
    const stored = getSettings();
    const settings = sanitizeSettings(req.body?.overrides || {}, stored);
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.startDate || '') ? req.body.startDate : undefined;
    const ai = await getLocalAiStatus(settings.aiModel);
    if (!ai.connected) {
      const error = new Error(ai.error || 'Local AI is not reachable yet.');
      error.status = 503;
      throw error;
    }
    if (!ai.installed) {
      const error = new Error(`Local AI model ${settings.aiModel} is not installed.`);
      error.status = 409;
      error.code = 'MODEL_NOT_INSTALLED';
      throw error;
    }
    const job = startGenerationJob({ settings, startDate, model: settings.aiModel, savePlan });
    res.status(202).json(job);
  } catch (error) { next(error); }
});

app.get('/api/generate/:jobId', (req, res) => {
  const job = getGenerationJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Generation job not found.' });
  res.json(job);
});

app.get('/api/mcp-config', (req, res) => {
  const authMode = getMcpAuthMode();
  res.json({
    endpoint: `${req.protocol}://${req.get('host')}/mcp`,
    authMode,
    token: authMode === 'token' ? getMcpToken() : null,
    transport: 'Streamable HTTP',
    version: '0.3.0',
    note: authMode === 'none'
      ? 'MCP authentication is disabled. Use this only behind a trusted secure tunnel or authenticated private reverse proxy.'
      : 'Send the bearer token in the Authorization header.'
  });
});

app.post('/api/mcp-config/rotate-token', (_req, res) => {
  res.json({ token: rotateMcpToken() });
});

app.get('/api/plans', (req, res) => res.json(listPlans(req.query.limit)));

app.post('/api/plans/import', (req, res, next) => {
  try {
    const raw = req.body?.text ? parsePlanText(req.body.text) : (req.body?.plan || req.body);
    const settings = getSettings();
    const plan = normalizeExternalPlan(raw, settings);
    res.status(201).json(savePlan(plan));
  } catch (error) { next(error); }
});

app.get('/api/plans/:id', (req, res) => {
  const plan = getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plan not found.' });
  res.json(plan);
});

app.delete('/api/plans/:id', (req, res) => {
  if (!deletePlan(req.params.id)) return res.status(404).json({ error: 'Plan not found.' });
  res.status(204).end();
});

app.get('/api/plans/:id/grocery-list', (req, res) => {
  const plan = getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plan not found.' });
  res.json(buildGroceryList(plan));
});

app.put('/api/plans/:id/meals/:mealId', (req, res, next) => {
  try {
    const plan = getPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    const updated = replaceMealWithData(plan, req.params.mealId, req.body?.replacement || req.body);
    res.json(savePlan(updated));
  } catch (error) { next(error); }
});

// Umbrel's app proxy can whitelist only /mcp; this route therefore applies its own auth.
app.all('/mcp', validateMcpOrigin, requireMcpAuth, (req, res) => {
  void mcpNodeHandler(req, res, req.body);
});

app.use(express.static(publicDir, { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error?.statusCode || error?.status || 500;
  res.status(status).json({ error: error?.message || 'Unexpected server error.', code: error?.code || undefined, job: error?.job || undefined });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`MealPilot v0.3.0 listening on http://0.0.0.0:${port}`);
  console.log(`MCP auth mode: ${getMcpAuthMode()}`);
});

async function shutdown() {
  console.log('Shutting down MealPilot...');
  server.close();
  await closeMcp().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
