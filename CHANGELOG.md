# Changelog

## 0.3.0 — Local AI generation

- Added a bundled Ollama service to the Umbrel app stack.
- Added one-click meal-plan generation directly inside MealPilot with no OpenAI API key.
- Added one-time local model download with progress reporting.
- Default model is `qwen3:4b-instruct`; lighter `qwen3:1.7b` and newer `qwen3.5:4b` can be selected in Preferences.
- Ollama cloud functionality is disabled with `OLLAMA_NO_CLOUD=1`.
- Ollama is not exposed through the Umbrel app proxy; MealPilot talks to it only on the internal Docker network.
- Model files persist under `${APP_DATA_DIR}/ollama`.
- Generation now runs as a background job so long local inference does not hold an HTTP request open.
- Multi-day plans are generated one day at a time for better reliability on small local models.
- Added JSON-schema structured outputs and validation for required meal types, dates, calories, and maximum cooking time.
- Existing MCP tools and manual JSON import remain available.
- GitHub Actions now builds automatically on pushes to `main` using the version in `umbrel-app.yml`, while tags and manual runs still work.

## 0.2.0 — MCP-first redesign

- Removed the OpenAI API dependency and API-key configuration.
- Added MCP-first read/write tools for preferences, pantry, plans, meal replacement, and grocery lists.
- Added manual prompt generation and JSON import fallback.

## 0.1.0

- Initial MealPilot Umbrel app with OpenAI API generation.
