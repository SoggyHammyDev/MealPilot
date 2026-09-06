# MealPilot for Umbrel

MealPilot is a private meal planner that can generate complete meal plans directly on an Umbrel using a local Ollama model. No OpenAI API key is required.

## What v0.3 does

Set your planning preferences once, then click **Generate meal plan**. MealPilot uses a local model to create structured meals containing:

- calories per serving
- ingredient names and quantities
- prep time
- cook time
- total time
- step-by-step instructions
- combined grocery list

MealPilot also keeps its Streamable HTTP MCP server, so compatible clients can read preferences, inspect saved plans, update the pantry, or save externally generated plans.

## Architecture

```text
Umbrel browser
     |
     v
MealPilot web/API  ---- SQLite (/data)
     |
     | internal Docker network only
     v
Ollama :11434  ---- model storage (/root/.ollama)

ChatGPT / MCP client (optional)
     |
     v
MealPilot /mcp
```

Ollama's port is not published by this app. Only the MealPilot container can reach it through the app's Docker network.

## No API key

The built-in generator uses local Ollama inference. `OLLAMA_NO_CLOUD=1` is set on the Ollama container, so cloud models and Ollama web-search features are disabled. MealPilot does not require or store an OpenAI API key.

The selected model still has to be downloaded from Ollama's model registry once. After that, its model files live in `${APP_DATA_DIR}/ollama` and are reused locally.

## Default model

The default is:

```text
qwen3:4b-instruct
```

Current choices in the UI:

| Model | Approx. download | Suggested use |
| --- | ---: | --- |
| `qwen3:1.7b` | 1.4 GB | Smaller RAM/CPU hosts |
| `qwen3:4b-instruct` | 2.5 GB | Recommended default |
| `qwen3.5:4b` | 3.4 GB | Newer/higher-quality option |

For CPU-only Umbrel hosts, 8 GB RAM or more is a comfortable target for the default model. Generation speed depends on the host. A seven-day plan is generated one day at a time so the browser can show progress and smaller models have less output to produce per request.

## First-run flow

1. Install MealPilot.
2. Open **Preferences** and set calories, days, servings, allergies, pantry, cooking-time limit, and model.
3. Return Home and click **Generate meal plan**.
4. If the model is missing, MealPilot starts a one-time download and shows progress.
5. Once installed, generation starts automatically.
6. The completed plan is validated, saved to SQLite, and displayed in the app.

## Local AI endpoints

The browser uses MealPilot's own API; Ollama is never exposed directly.

```text
GET  /api/ai/status
POST /api/ai/pull
GET  /api/ai/pull
POST /api/generate
GET  /api/generate/:jobId
```

Generation runs in the background. This avoids holding a browser/proxy request open while CPU inference takes several minutes.

## Structured generation

MealPilot uses Ollama's JSON-schema structured output support. A multi-day plan is produced one day at a time and checked for:

- correct date
- every requested meal type
- maximum prep + cook time
- daily calories within a reasonable tolerance
- valid ingredients and instructions

A failed day is retried once with deterministic settings before the job is marked failed.

## MCP

MCP remains available at:

```text
/mcp
```

The default configuration uses a MealPilot-generated bearer token. View or rotate it from the MCP page in the app.

Exposed tools include:

- `get_mealpilot_context`
- `get_preferences`
- `update_preferences`
- `get_pantry`
- `update_pantry`
- `list_meal_plans`
- `get_meal_plan`
- `get_grocery_list`
- `save_meal_plan`
- `replace_meal`
- `delete_meal_plan`

## Persistent data

MealPilot data:

```text
${APP_DATA_DIR}/data
```

Ollama models:

```text
${APP_DATA_DIR}/ollama
```

Both survive app/container restarts and upgrades.

## Local development

```bash
npm install
npm test
npm run check
docker compose -f docker-compose.local.yml up --build
```

Then open:

```text
http://localhost:3000
```

The local compose file starts both MealPilot and Ollama.

## Publishing GHCR

The included workflow is:

```text
.github/workflows/publish.yml
```

It now runs automatically on pushes to `main`. For a normal `main` push, it reads the version from:

```text
soggyhammy-mealpilot/umbrel-app.yml
```

For v0.3.2 it publishes:

```text
ghcr.io/soggyhammydev/mealpilot:0.3.2
ghcr.io/soggyhammydev/mealpilot:latest
```

You can still run the workflow manually or publish by pushing a `v0.3.2` Git tag.

## Umbrel install

The custom app store uses:

```text
umbrel-app-store.yml
soggyhammy-mealpilot/umbrel-app.yml
soggyhammy-mealpilot/docker-compose.yml
```

The app image is:

```text
ghcr.io/soggyhammydev/mealpilot:0.3.2
```

and the local inference service uses:

```text
ollama/ollama:0.33.3
```

## Notes

Calories and nutrition values produced by a local language model are estimates. MealPilot is a planning tool, not a medical or dietetic calculator. Allergies are included as hard constraints in the prompt and validated structurally where possible, but users with severe allergies should still verify ingredients themselves.

## License

MIT
