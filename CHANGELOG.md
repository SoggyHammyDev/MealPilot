# Changelog

## 0.2.0 — MCP-first / no API key

- Removed all OpenAI Responses API calls.
- Removed the OpenAI API-key UI, API endpoints, and model selector.
- MealPilot no longer requires any AI provider API key.
- Added `get_mealpilot_context` so an MCP client can read the complete planning brief before generating meals.
- Added `get_pantry` and `update_pantry` tools.
- Reworked `save_meal_plan` so the AI client supplies the completed structured plan.
- Reworked `replace_meal` so the AI client supplies the completed replacement meal.
- Added `delete_meal_plan`.
- Added a local prompt builder for ChatGPT or any other AI client.
- Added JSON/code-fence import for clients that cannot write through MCP.
- Added REST import and structured meal-replacement endpoints.
- On upgrade, any OpenAI API key left in the v0.1 SQLite column is automatically cleared.
- Updated the Umbrel image tag to `ghcr.io/soggyhammydev/mealpilot:0.2.0`.

## 0.1.0

- Initial Umbrel release.
- Multi-day structured meal plans.
- Local SQLite storage.
- Combined grocery lists.
- Single-meal replacement.
- OpenAI Responses API generation.
- Streamable HTTP MCP server.
