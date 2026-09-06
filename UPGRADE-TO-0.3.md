# Upgrading MealPilot to v0.3.0

v0.3 keeps the same Umbrel app ID and the same `${APP_DATA_DIR}/data` directory, so existing preferences and saved meal plans remain in place.

The upgrade adds a second service named `ollama` and a new persistent directory:

```text
${APP_DATA_DIR}/ollama
```

This directory contains local model files and can use several gigabytes of disk space.

## Recommended resources

The default `qwen3:4b-instruct` model download is roughly 2.5 GB. For a comfortable CPU-only setup, use a host with about 8 GB RAM or more. On smaller hosts, select `qwen3:1.7b` in Preferences; its model download is roughly 1.4 GB.

Generation speed depends heavily on CPU/GPU performance. CPU-only generation is supported but may take a few minutes for a multi-day plan.

## Publish and update

1. Push v0.3.0 to GitHub. The included workflow now builds GHCR automatically on a push to `main`.
2. Confirm `ghcr.io/soggyhammydev/mealpilot:0.3.0` exists.
3. Refresh the custom app store in Umbrel.
4. Update MealPilot.
5. Open MealPilot and wait for the Local AI status to become reachable.
6. Click **Generate meal plan**. If the selected model is not installed, MealPilot downloads it once and then starts generation.

## Manual container checks

```bash
sudo docker pull ghcr.io/soggyhammydev/mealpilot:0.3.0
sudo docker pull ollama/ollama:0.33.3
```

After installation, the model itself is downloaded by Ollama when requested from the MealPilot UI.
