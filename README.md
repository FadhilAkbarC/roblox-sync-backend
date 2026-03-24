# DailyStreaks (`daily_streak`)

Generate an auto-updating GitHub streak SVG card for your profile README.

- Uses full contribution history (GraphQL) + recent push events (REST) for faster same-day updates.
- Output file: `assets/github-streak.svg`.
- Auto-update workflow: `.github/workflows/update-streaks.yml`.
- Repository path: `futurisme/daily_streak` (use this exact path in raw image URLs).

## Quick setup (start to finish)

### Step 1) Fork or clone this repository

Use this repo as-is or fork it to your own account.

### Step 2) Set repository variables

Go to **Settings → Secrets and variables → Actions → Variables**.

Required:
- `STREAK_USERNAME`: GitHub username to track.

Optional:
- `STREAK_TIMEZONE_OFFSET` (default `0`, valid range `-12..14`)
- `STREAK_MAX_PAGES` (default `5`, internally clamped to `1..10`)
- `STREAK_LOOKBACK_DAYS` (default `45`)

### Step 3) Confirm workflow permissions

Go to **Settings → Actions → General → Workflow permissions** and set:
- **Read and write permissions**

This allows `github-actions[bot]` to commit the generated SVG.

### Step 4) Run the workflow once

Go to **Actions → Update Daily Streak Card → Run workflow**.

After success, `assets/github-streak.svg` will be generated/updated.

### Step 5) Embed the card in your profile README

```md
![DailyStreaks](https://raw.githubusercontent.com/futurisme/daily_streak/main/assets/github-streak.svg)
```

## Local run (optional)

Online mode:

```bash
python3 src/dailystreaks.py --username futurisme --output assets/github-streak.svg
```

Offline mode with sample events:

```bash
python3 src/dailystreaks.py --username demo --events-file examples/sample_events.json --output assets/github-streak.svg
```

Sample fixture dates are refreshed to **March 24, 2026**.
