# MealPilot for Umbrel

MealPilot is a self-hosted, **MCP-first meal planner** for umbrelOS. Version 0.2 intentionally does **not** call an AI provider API. There is no OpenAI API key field, no model selector, and no model billing inside MealPilot.

Instead, the AI client does the intelligence work:

```text
ChatGPT / another MCP-capable AI
        |
        | 1. get_mealpilot_context
        v
MealPilot on Umbrel
        |
        | preferences + pantry + constraints
        v
AI generates the complete meal plan itself
        |
        | 2. save_meal_plan
        v
MealPilot SQLite + web UI + grocery list
```

Every stored meal can include:

- calories per serving
- exact ingredient quantities for the configured servings
- prep time
- cook time
- total time
- step-by-step instructions
- optional chef notes

MealPilot also combines repeated ingredients into one grocery list.

## Why v0.2 exists

The original v0.1 generated plans by calling the OpenAI Responses API directly. That required a separate API key and API billing.

v0.2 reverses the relationship: the MCP client is the model, and MealPilot is the local state/store. The app never needs to know which model produced a plan.

On first v0.2 startup, MealPilot clears any OpenAI API key that may still exist in the legacy v0.1 SQLite column.

## Current ChatGPT product limitation

MealPilot's MCP server supports both read and write tools, but whether ChatGPT can use those tools depends on your ChatGPT plan and workspace features.

As of September 2026, OpenAI documents full custom MCP write/modify support for **Business and Enterprise/Edu**. OpenAI documents **Pro** custom MCP as read/fetch only. ChatGPT also connects to remote MCP servers rather than directly to a LAN-only MCP endpoint; a private Umbrel needs OpenAI Secure MCP Tunnel or another safe remote-access path supported by your client.

If your current ChatGPT account cannot write to a custom MCP, MealPilot still requires **no API key**: use the built-in **Build ChatGPT prompt** button, paste that prompt into ChatGPT, then paste the returned JSON into **Import & save plan**.

Official product documentation:

- https://help.openai.com/en/articles/12584461

## Main workflows

### A. Write-capable MCP client

1. Configure your preferences in MealPilot.
2. Connect the client to MealPilot's `/mcp` endpoint.
3. Ask: `Create my MealPilot meal plan for next week and save it.`
4. The client should call `get_mealpilot_context`.
5. The client generates the meals itself.
6. The client calls `save_meal_plan`.
7. Open MealPilot and the plan is already in **Saved plans**.

### B. ChatGPT/manual import fallback

1. Configure preferences in MealPilot.
2. On Home, choose the start date.
3. Click **Build ChatGPT prompt**.
4. Copy the prompt into ChatGPT.
5. ChatGPT returns only the requested JSON.
6. Paste it into **Import a plan from ChatGPT**.
7. Click **Import & save plan**.

No OpenAI API key is needed in either workflow.

## Repository layout

```text
mealpilot-umbrel/
├── .github/workflows/publish.yml
├── public/
│   ├── app.js
│   ├── favicon.svg
│   ├── index.html
│   └── styles.css
├── src/
│   ├── db.js
│   ├── mcp.js
│   ├── meal-plan.js
│   └── server.js
├── tests/
│   └── meal-plan.test.js
├── soggyhammy-mealpilot/
│   ├── docker-compose.yml
│   ├── icon.png
│   └── umbrel-app.yml
├── Dockerfile
├── docker-compose.local.yml
├── package.json
└── umbrel-app-store.yml
```

## Local development

Requirements:

- Node.js 22+
- build tooling for `better-sqlite3` if a prebuilt binary is unavailable

```bash
npm install
npm test
npm run check
npm start
```

Open:

```text
http://localhost:3000
```

Or build with Docker:

```bash
docker compose -f docker-compose.local.yml up --build
```

## Persistent data

Umbrel mounts:

```text
${APP_DATA_DIR}/data -> /data
```

MealPilot stores:

```text
/data/mealpilot.db
/data/mcp-token.txt
```

SQLite runs in WAL mode.

## MCP endpoint

The app exposes Streamable HTTP MCP at:

```text
http://<umbrel-host>:4788/mcp
```

The exact URL shown by the app may differ when you access MealPilot through a reverse proxy or remote hostname.

### Authentication

The Umbrel package defaults to:

```text
MCP_AUTH_MODE=token
```

Every MCP request must therefore include:

```http
Authorization: Bearer mp_...
```

The generated token is shown under **MCP** in the UI and is stored at:

```text
/data/mcp-token.txt
```

You can rotate it from the UI.

There is an advanced environment setting:

```text
MCP_AUTH_MODE=none
```

Do **not** use tokenless mode on a publicly reachable endpoint. It is intended only for deployments where a trusted secure tunnel or authenticated reverse proxy provides the access boundary.

## MCP tools

### `get_mealpilot_context`

Call this before generating a plan. It returns:

- saved planning preferences
- pantry contents
- a complete generation brief
- instructions to save the structured result

Optional input:

- `startDate` in `YYYY-MM-DD`

### `get_preferences`

Read:

- calorie target
- default days
- servings
- meal types
- dietary style
- allergies
- avoid list
- maximum meal time
- budget guidance
- custom instructions
- pantry text

### `update_preferences`

Update planning defaults except pantry.

### `get_pantry`

Read pantry contents.

### `update_pantry`

Replace pantry contents.

### `list_meal_plans`

List saved plan IDs and summary metadata.

### `get_meal_plan`

Read a complete plan, including meal IDs.

### `get_grocery_list`

Get MealPilot's merged grocery list for one saved plan.

### `save_meal_plan`

Save a plan the MCP client already generated. MealPilot does not invoke a model.

The structure includes:

```json
{
  "title": "Week of September 7",
  "summary": "High-protein week with quick dinners.",
  "targetCalories": 2000,
  "servings": 2,
  "days": [
    {
      "date": "2026-09-07",
      "meals": [
        {
          "mealType": "dinner",
          "name": "Chicken Fajita Rice Bowl",
          "calories": 620,
          "servings": 2,
          "prepMinutes": 10,
          "cookMinutes": 20,
          "ingredients": [
            { "name": "chicken breast", "amount": 12, "unit": "oz", "notes": null }
          ],
          "instructions": ["Cook the rice.", "Cook the seasoned chicken and vegetables."],
          "chefNote": null
        }
      ]
    }
  ]
}
```

Calories are per person/per serving. Ingredient amounts are the total quantity needed for the configured number of servings.

### `replace_meal`

Inputs:

- `planId`
- `mealId`
- complete structured `replacement` meal

The client generates the replacement itself and MealPilot recalculates that day's totals.

### `delete_meal_plan`

Delete a saved plan.

## REST API

```text
GET    /api/health
GET    /api/settings
PUT    /api/settings
POST   /api/generation-prompt
GET    /api/mcp-config
POST   /api/mcp-config/rotate-token
GET    /api/plans
POST   /api/plans/import
GET    /api/plans/:id
DELETE /api/plans/:id
GET    /api/plans/:id/grocery-list
PUT    /api/plans/:id/meals/:mealId
*      /mcp
```

There are deliberately **no** `/api/settings/openai-key`, `/api/settings/test-openai`, or `/api/generate` endpoints in v0.2.

## Build and publish to GHCR

The Umbrel definition expects:

```text
ghcr.io/soggyhammydev/mealpilot:0.2.0
```

The included GitHub Action builds `linux/amd64` and `linux/arm64`.

### Manual Action run

1. Push this v0.2 project to GitHub.
2. Open **Actions → Build and publish MealPilot**.
3. Click **Run workflow**.
4. Enter:

```text
0.2.0
```

The workflow publishes:

```text
ghcr.io/soggyhammydev/mealpilot:0.2.0
ghcr.io/soggyhammydev/mealpilot:latest
```

Keep the GHCR package public so Umbrel can pull it without registry credentials.

You can verify from the Umbrel host:

```bash
sudo docker pull ghcr.io/soggyhammydev/mealpilot:0.2.0
```

## Update an existing v0.1 Umbrel install

The app ID stays:

```text
soggyhammy-mealpilot
```

and the manifest version becomes `0.2.0`, so the community store can treat this as an update rather than a new app.

The existing `/data/mealpilot.db` is reused. Existing plans remain readable. Any legacy stored OpenAI API key is nulled on v0.2 startup.

## Security notes

- MealPilot does not store an AI provider API key.
- `/mcp` bypasses Umbrel's browser login so machine clients can reach it; MealPilot's own bearer token protects that route by default.
- Treat the MCP bearer token like a password.
- Do not expose a tokenless MCP endpoint publicly.
- Allergies entered in MealPilot are passed to the AI as hard exclusions, but AI-generated nutrition and ingredients are estimates. Verify labels and ingredient safety yourself.

## Version

Current version: **0.2.0**

## License

MIT
