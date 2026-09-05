import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getSettings, updateSettings, setOpenAiKey, clearOpenAiKey, savePlan, getPlan, listPlans, deletePlan } from './db.js';
import { buildGroceryList, sanitizeSettings } from './meal-plan.js';
import { generatePlanWithAI, replaceMealWithAI, testOpenAI } from './openai.js';
import { getMcpToken, rotateMcpToken, requireMcpToken, validateMcpOrigin, mcpNodeHandler, closeMcp } from './mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const app = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  const settings = getSettings();
  res.json({ ok: true, version: '0.1.0', openaiConfigured: settings.hasApiKey });
});

app.get('/api/settings', (_req, res) => res.json(getSettings()));

app.put('/api/settings', (req, res, next) => {
  try {
    res.json(updateSettings(req.body || {}));
  } catch (error) { next(error); }
});

app.put('/api/settings/openai-key', (req, res, next) => {
  try {
    res.json(setOpenAiKey(req.body?.apiKey));
  } catch (error) { next(error); }
});

app.delete('/api/settings/openai-key', (_req, res, next) => {
  try {
    res.json(clearOpenAiKey());
  } catch (error) { next(error); }
});

app.post('/api/settings/test-openai', async (_req, res, next) => {
  try {
    const settings = getSettings({ includeSecret: true });
    const result = await testOpenAI(settings.apiKey, settings.model);
    res.json({ ok: true, message: result });
  } catch (error) { next(error); }
});

app.get('/api/mcp-config', (req, res) => {
  res.json({
    endpoint: `${req.protocol}://${req.get('host')}/mcp`,
    token: getMcpToken(),
    transport: 'Streamable HTTP',
    protocol: 'MCP 2026-07-28 with legacy stateless compatibility'
  });
});

app.post('/api/mcp-config/rotate-token', (_req, res) => {
  res.json({ token: rotateMcpToken() });
});

app.post('/api/generate', async (req, res, next) => {
  try {
    const stored = getSettings({ includeSecret: true });
    const settings = sanitizeSettings(req.body || {}, stored);
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.startDate || '')
      ? req.body.startDate
      : new Date().toISOString().slice(0, 10);
    const plan = await generatePlanWithAI(settings, startDate, stored.apiKey);
    savePlan(plan);
    res.status(201).json(plan);
  } catch (error) { next(error); }
});

app.get('/api/plans', (req, res) => res.json(listPlans(req.query.limit)));

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

app.post('/api/plans/:id/meals/:mealId/replace', async (req, res, next) => {
  try {
    const plan = getPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    const settings = getSettings({ includeSecret: true });
    const updated = await replaceMealWithAI({
      plan,
      mealId: req.params.mealId,
      notes: req.body?.notes,
      settings,
      apiKey: settings.apiKey
    });
    savePlan(updated);
    res.json(updated);
  } catch (error) { next(error); }
});

// Umbrel's app proxy can whitelist only /mcp; this route therefore protects itself.
app.all('/mcp', validateMcpOrigin, requireMcpToken, (req, res) => {
  void mcpNodeHandler(req, res, req.body);
});

app.use(express.static(publicDir, { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error?.statusCode || error?.status || 500;
  res.status(status).json({ error: error?.message || 'Unexpected server error.' });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`MealPilot listening on http://0.0.0.0:${port}`);
});

async function shutdown() {
  console.log('Shutting down MealPilot...');
  server.close();
  await closeMcp().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
