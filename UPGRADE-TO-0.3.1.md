# Upgrading MealPilot to v0.3.1

v0.3.1 is a reliability patch for the local Ollama generator. It keeps the same SQLite database and Ollama model volume as v0.3.0.

## What changed

- Fixes generation failing when a local model returns a meal above your maximum prep + cook time.
- Adds stronger dynamic time constraints to the Ollama structured-output schema.
- Gives the model its failed output and exact time arithmetic so it can repair the day.
- Replaces recipes that cannot realistically fit the configured time instead of accepting fake timing estimates.
- Retries validation up to four times.

## Publish and upgrade

Push the v0.3.1 project to `main`. The included GitHub Actions workflow reads `version: "0.3.1"` from `soggyhammy-mealpilot/umbrel-app.yml` and publishes:

```text
ghcr.io/soggyhammydev/mealpilot:0.3.1
ghcr.io/soggyhammydev/mealpilot:latest
```

You can verify the image from the Umbrel host with:

```bash
sudo docker pull ghcr.io/soggyhammydev/mealpilot:0.3.1
```

Then refresh the Community App Store and update MealPilot. Existing plans and downloaded Ollama models are preserved.
