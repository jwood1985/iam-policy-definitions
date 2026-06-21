---
description: Run the dt-vision Dynatrace UI automation agent
allowed-tools: Bash
---

Run the dt-vision browser agent to accomplish the following goal against the configured Dynatrace tenant:

**Goal:** $ARGUMENTS

Steps:
1. Use the Bash tool to run: `dt-vision "$ARGUMENTS"`
2. Stream and display progress as it prints (steps, screenshots saved, auth status).
3. When the run completes, summarize: what was accomplished, how many steps, whether auth succeeded, the final URL visited, and where screenshots were saved.
4. If the command fails, show the error and suggest fixes (missing env vars, missing `dt-vision` binary, Playwright not installed).

**Environment variables required** (must be set before running):
- `ANTHROPIC_API_KEY` — Claude API key
- `DT_TENANT` — tenant ID (e.g. `qof78400`) **or** `DT_ENV` — full URL
- `DT_TOKEN` — Dynatrace API token (optional if using SSO)
- `DT_USERNAME` / `DT_PASSWORD` — SSO credentials (optional)
- `NTFY_TOPIC` — ntfy.sh topic for push notifications (optional)

If any required variable is missing, tell the user which ones are needed and stop before running.
