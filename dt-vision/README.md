# dt-vision

A browser vision agent for Dynatrace Platform UI automation. Give it a natural-language goal; it launches a headless Chromium browser, authenticates against your tenant, and uses Claude's vision API to navigate the UI step-by-step until the goal is complete—taking screenshots at every step.

Works as a **CLI tool**, an **importable Node module**, and a **Claude Code slash command**.

---

## How it works

```
goal (text)
    │
    ▼
planGoal()          ← maps goal keywords to known DT app paths
    │
    ▼
DTBrowser.launch()  ← headless Chromium via Playwright
    │
    ▼
handleSSO()         ← SSO credential login → token injection fallback
    │
    ▼
loop (up to maxSteps):
  screenshot → analyzeScreen() (Claude vision) → nextAction
  → click / coordinate / drag / input / scroll / navigate
    │
    ▼
onDone(summary)     ← screenshots saved to artifactsDir
```

Without an `ANTHROPIC_API_KEY`, the agent falls back to DOM-only analysis—no vision, but still useful for structured pages.

---

## Prerequisites

- **Node.js** 18+
- **Playwright Chromium**: `npx playwright install chromium --with-deps`
- **Anthropic API key** (Claude vision mode; optional for DOM-only)
- A Dynatrace Platform tenant (DPS / `*.apps.dynatrace.com`)

---

## Installation

```bash
npm install -g dt-vision          # once published to npm
# or install directly from this repo:
npm install -g /path/to/dt-vision
```

---

## Quick start — CLI

Set environment variables (or copy `.env.template` → `.env`):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export DT_TENANT=qof78400          # or DT_ENV=https://qof78400.apps.dynatrace.com
export DT_TOKEN=dt0c01...          # Dynatrace API token
export DT_USERNAME=you@example.com # SSO credentials (optional)
export DT_PASSWORD=yourpassword
```

Run:

```bash
dt-vision "show me all open problems"
dt-vision "navigate to the Smartscape app and describe what services are visible"
dt-vision "open the Dashboards app and list the available dashboards"
```

Screenshots are saved to `./artifacts/` by default.

---

## Quick start — embedding in another project

Install as a dependency:

```bash
npm install /path/to/dt-vision     # local path, or npm package name once published
```

Import and call `runDTVisionTask`:

```js
import { runDTVisionTask } from 'dt-vision';

const summary = await runDTVisionTask({
  goal: 'find all critical problems and describe them',
  tenant: 'qof78400',                       // or tenantURL: 'https://qof78400.apps.dynatrace.com'
  dtToken: process.env.DT_TOKEN,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,

  onStep: ({ stepNum, observation, goalProgress, action }) => {
    console.log(`Step ${stepNum} (${goalProgress}%): ${observation}`);
    if (action) console.log(`  → ${action.type}: ${action.target}`);
  },

  onDone: (summary) => {
    console.log(`Done in ${summary.stepsTotal} steps. Final URL: ${summary.finalUrl}`);
    console.log(summary.observation);
  },

  onError: ({ message, step }) => {
    console.error(`Failed at step ${step}: ${message}`);
  },
});
```

`runDTVisionTask` returns the same summary object passed to `onDone`.

### Streaming step data into your own UI

Each `onStep` callback receives:

```ts
{
  stepNum: number,          // 0 = plan ready, 1+ = agent steps
  observation: string,      // what Claude sees on screen
  goalProgress: number,     // 0–100 estimate
  action: {
    type: 'click' | 'coordinate' | 'drag' | 'navigate' | 'input' | 'scroll' | 'screenshot' | 'done' | 'error',
    target: string,
    value?: string,         // for 'input' actions
    reason: string,
  } | null,
  screenshot: {
    path: string | null,    // absolute path to saved file
    filename: string,
    url: string,            // browser URL at time of screenshot
    sizeBytes: number,
  },
  isComplete: boolean,
}
```

### Using DTBrowser directly

If you want browser control without the full agent loop:

```js
import { DTBrowser } from 'dt-vision';

const browser = new DTBrowser({
  token: process.env.DT_TOKEN,
  tenantURL: 'https://qof78400.apps.dynatrace.com',
  headless: true,
  artifactsDir: './screenshots',
});

await browser.launch();
await browser.navigate('/ui/apps/dynatrace.davis.problems');
const shot = await browser.screenshot('problems');
console.log('saved to', shot.path);
await browser.close();
```

`DTBrowser` methods: `launch()`, `navigate(url)`, `screenshot(label)`, `clickText(text)`, `clickAt(x, y)`, `clickAtAndVerify(x, y)`, `dragAndDrop(x1, y1, x2, y2)`, `typeText(text)`, `scroll(direction)`, `getPageContent()`, `close()`.

---

## Full configuration reference

| Option | Type | Default | Description |
|---|---|---|---|
| `goal` | `string` | required | Natural-language task description |
| `tenant` | `string` | — | Short tenant ID, e.g. `qof78400` |
| `tenantURL` | `string` | — | Full URL, e.g. `https://qof78400.apps.dynatrace.com` |
| `credentials` | `{ username, password }` | — | SSO login credentials |
| `dtToken` | `string` | — | Dynatrace API token (falls back to `dtctl` if omitted) |
| `anthropicApiKey` | `string` | — | Enables Claude vision; DOM-only mode without it |
| `model` | `string` | `claude-opus-4-7` | Claude model ID |
| `viewport` | `{ width, height }` | `{ width: 1280, height: 800 }` | Browser viewport |
| `screenshotFormat` | `'jpeg'` \| `'png'` | `'jpeg'` | Screenshot format |
| `screenshotQuality` | `number` | `80` | JPEG quality (1–100) |
| `headless` | `boolean` | `true` | Run browser headlessly |
| `maxSteps` | `number` | `15` | Maximum agentic steps before stopping |
| `iframeWaitMs` | `number` | `8000` | Wait after auth before first screenshot (iframe apps need time to render) |
| `artifactsDir` | `string` | `'./artifacts'` | Directory for saved screenshots |
| `onStep` | `function` | — | Called after each step |
| `onDone` | `function` | — | Called on success with summary object |
| `onError` | `function` | — | Called on fatal error with `{ message, step }` |

### Environment variables (CLI)

| Variable | Maps to |
|---|---|
| `ANTHROPIC_API_KEY` | `anthropicApiKey` |
| `DT_TENANT` | `tenant` |
| `DT_ENV` | `tenantURL` |
| `DT_TOKEN` | `dtToken` |
| `DT_USERNAME` | `credentials.username` |
| `DT_PASSWORD` | `credentials.password` |
| `DT_MODEL` | `model` |
| `DT_HEADLESS` | `headless` (`false` to show browser) |
| `DT_MAX_STEPS` | `maxSteps` |
| `DT_ARTIFACTS_DIR` | `artifactsDir` |
| `NTFY_TOPIC` | Push notification topic (ntfy.sh) |

---

## Authentication

The agent attempts authentication in this order:

1. **SSO credentials** — if `credentials.username` and `credentials.password` are set, fills the two-step DT SSO form (email → Next → password → Sign in)
2. **Token injection** — injects the API token into `localStorage` / `sessionStorage` keys and reloads
3. **Unauthenticated** — continues in DOM-only mode; vision will see the login wall

SSO is the most reliable. Token injection works on some tenant configurations.

---

## Known Dynatrace app paths

The agent automatically routes goal keywords to the right starting path:

| Keyword in goal | App | Path |
|---|---|---|
| `problem`, `alert`, `incident` | Davis AI Problems | `/ui/apps/dynatrace.davis.problems` |
| `service`, `infra` | Infrastructure Ops | `/ui/apps/dynatrace.infraops` |
| `dashboard` | Dashboards | `/ui/apps/dynatrace.dashboards` |
| `log` | Logs & Events | `/ui/apps/dynatrace.logs` |
| `notebook` | Notebooks | `/ui/apps/dynatrace.notebooks` |
| `automation`, `workflow` | Automations | `/ui/apps/dynatrace.automations` |
| `setting` | Settings | `/ui/apps/dynatrace.settings` |
| `smartscape`, `topology` | Smartscape | `/ui/apps/dynatrace.smartscape` |
| _(anything else)_ | Home | `/ui` |

> **Smartscape note:** Renders inside a cross-origin iframe and takes 20–30 seconds to load. The `iframeWaitMs` option (default 8s) can be raised to `25000` for reliable first screenshots. The Topology Builder is not a separate app — custom topology links are managed via Settings (`builtin:topology.model.custom-type`) or the DT REST API.

---

## VS Code / Claude Code integration

The `deploy/` directory contains a workspace kit:

```
deploy/
├── install.sh                   # run once per workspace
├── .env.template                # copy to .env, fill credentials
└── .claude/
    └── commands/
        └── dt-vision.md        # /dt-vision slash command
```

**Install into a workspace:**

```bash
bash deploy/install.sh
```

Then in any Claude Code session in that workspace:

```
/dt-vision list all open problems
/dt-vision show me what's in the Smartscape app
```

Claude will run the agent, stream progress, and summarize results.

---

## Push notifications

Set `NTFY_TOPIC` to receive step-by-step push notifications via [ntfy.sh](https://ntfy.sh):

```bash
export NTFY_TOPIC=my-topic
dt-vision "check for critical alerts"
```

Notifications are sent for: plan, each step, done, and error events.

---

## Artifacts

Every run saves timestamped screenshots to `artifactsDir`:

```
artifacts/
  2026-04-27T14-30-00-000Z_initial.jpg
  2026-04-27T14-30-03-000Z_step-1.jpg
  ...
  2026-04-27T14-30-45-000Z_final.jpg
```

The `artifacts/` directory is git-ignored by default.
