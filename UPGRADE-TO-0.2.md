# Upgrade MealPilot 0.1.0 → 0.2.0

MealPilot 0.2.0 removes the built-in OpenAI API integration and makes MCP/manual import the generation path.

## 1. Replace your GitHub repository contents

Upload the full v0.2.0 project, including the hidden directory:

```text
.github/workflows/publish.yml
```

The app ID remains `soggyhammy-mealpilot`, so this is an update to the same Umbrel app.

## 2. Publish the Docker image

In GitHub:

1. Open **Actions**.
2. Open **Build and publish MealPilot**.
3. Click **Run workflow**.
4. Enter `0.2.0`.
5. Wait for the build to finish successfully.

The expected image is:

```text
ghcr.io/soggyhammydev/mealpilot:0.2.0
```

Verify it from the Umbrel host:

```bash
sudo docker pull ghcr.io/soggyhammydev/mealpilot:0.2.0
```

## 3. Refresh the Community App Store

Refresh/update your custom app store in umbrelOS. MealPilot should now show version `0.2.0` and offer an update.

The app continues to mount the same persistent directory:

```text
${APP_DATA_DIR}/data
```

so existing meal plans remain available.

## 4. What happens to the old API key?

On first v0.2 startup, MealPilot checks whether the old v0.1 `openai_api_key` SQLite column exists. If it does, the stored value is set to `NULL`.

New v0.2 databases do not create an API-key column at all.

## 5. New workflow

### With write-capable MCP

Ask the AI client to create a MealPilot plan. It should:

1. call `get_mealpilot_context`
2. generate the plan itself
3. call `save_meal_plan`

### Without write-capable MCP

1. Open MealPilot.
2. Save your preferences.
3. Click **Build ChatGPT prompt**.
4. Paste it into ChatGPT.
5. Copy ChatGPT's JSON response.
6. Paste it into **Import a plan from ChatGPT**.
7. Click **Import & save plan**.

This fallback also requires no OpenAI API key inside MealPilot.
