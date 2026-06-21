#!/usr/bin/env bash
# install.sh — wire dt-vision into the current VS Code workspace
# Run from the workspace root: bash /path/to/install.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> Installing dt-vision npm package globally from $REPO_DIR…"
npm install -g "$REPO_DIR"

echo "==> Installing Playwright Chromium…"
npx playwright install chromium --with-deps 2>/dev/null || true

echo "==> Copying .claude/commands into workspace…"
mkdir -p .claude/commands
cp "$SCRIPT_DIR/.claude/commands/dt-vision.md" .claude/commands/dt-vision.md

echo "==> Copying .env.template…"
if [ ! -f .env ]; then
  cp "$SCRIPT_DIR/.env.template" .env
  echo "    Created .env — fill in your credentials."
else
  echo "    .env already exists — skipping."
fi

echo ""
echo "Done. Next steps:"
echo "  1. Edit .env with your ANTHROPIC_API_KEY, DT_TENANT, and DT_TOKEN"
echo "  2. Open this workspace in VS Code with Claude Code extension"
echo "  3. Type /dt-vision <your goal> in the Claude Code panel"
