# Upgrading MealPilot to v0.3.2

v0.3.2 is a local-generation reliability patch. It keeps the same SQLite database and Ollama model volume as v0.3.1, so no model re-download is required.

## What changed

- Explicit per-meal calorie budgets now add up to the configured daily target.
- Failed calorie validation reports the actual total and the amount that needs to be added or removed.
- Repair attempts must adjust plausible portions/ingredients or replace meals rather than only changing calorie numbers.
- Exactly one of each selected meal type is generated.

## Publish

Push this project to `main`. The included workflow reads version `0.3.2` from the Umbrel manifest and publishes:

```text
ghcr.io/soggyhammydev/mealpilot:0.3.2
ghcr.io/soggyhammydev/mealpilot:latest
```

On Umbrel you can verify the image with:

```bash
sudo docker pull ghcr.io/soggyhammydev/mealpilot:0.3.2
```

Then refresh your Community App Store and update MealPilot.
