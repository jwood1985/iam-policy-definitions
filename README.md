# Dynatrace IAM Policy Definitions

This repository contains IAM policy definitions, Kubernetes front-end demo applications, and the `dt-vision` browser automation agent — all scoped to the Dynatrace tenant `qof78400` for demonstrating Gen3 platform capabilities including RUM, IAM, and observability.

---

## Repository Structure

```
.
├── README.md
├── readout.md                    # LLM observability findings report
├── readout.pdf                   # PDF export of readout.md
├── iam-policy-definition.code-workspace
├── artifacts/                    # Auto-generated screenshots from dt-vision / RUM traffic runs
├── dt-vision/                    # Browser vision agent (Playwright + Claude)
│   ├── agent.js                  # Core vision loop
│   ├── auth.js                   # SSO login handler
│   ├── browser.js                # DTBrowser Playwright wrapper
│   ├── cli.js                    # CLI entry point (`dt-vision "<goal>"`)
│   ├── index.js                  # Package entry / importable module
│   ├── vision.js                 # Claude vision API integration
│   ├── notify.js                 # ntfy.sh notification helper
│   ├── dtctl.js                  # dtctl CLI wrapper
│   ├── setup-iam-playwright.js   # IAM policy/group/binding setup via browser session
│   ├── generate-rum-traffic.js   # Playwright RUM traffic generator for demo apps
│   ├── configure-rum.cjs         # RUM configuration helper
│   ├── setup-dt-apps.cjs         # Dynatrace app setup helper
│   ├── create-web-apps*.cjs      # Web application entity creation scripts
│   ├── diag-rum.js               # RUM diagnostics
│   ├── test-env.mjs              # Environment/credential validation
│   ├── package.json
│   ├── .env.template             # Environment variable template
│   ├── artifacts/                # dt-vision screenshot output
│   └── deploy/
│       └── install.sh            # One-shot install: npm global install + Playwright chromium
└── k8s-frontend-apps/            # Demo frontend apps deployed on AKS
    ├── namespace.yaml            # frontend-apps namespace
    ├── trip-advisor-configmap.yaml
    ├── trip-advisor-deployment.yaml
    ├── trade-advisor-configmap.yaml
    └── trade-advisor-deployment.yaml
```

---

## IAM Policies

Three IAM policies are defined in `dt-vision/setup-iam-playwright.js` and applied to the `qof78400` tenant:

### 1. Standard User – Gen3
Broad platform access for standard users:
- App states, documents, unified analysis screens
- Grail (bucket definitions, filter segments)
- OpenPipeline read, Hub catalog, AppEngine
- AutomationEngine (read + run; write for SIMPLE workflows)
- Davis AI, Davis Copilot, SLOs, Settings, Extensions
- Classic roles: viewer + view-security-problems

### 2. Gen3 RUM Foundation
Read access to Grail-stored RUM data:
- `storage:user.replays:read`
- `storage:buckets:read` scoped to: `default_web_user_replays`, `default_mobile_user_replays`, `default_user_error_events`, `default_user_events`, `default_user_sessions`
- Session Replay resources, events, entities

### 3. Gen3 RUM Policy – Restricted by App
Granular session/event read for app-scoped access:
- `storage:user.sessions:read`
- `storage:user.events:read`

Each policy has a matching group and `joshuadwood.phd@gmail.com` is added to all three groups.

---

## Demo Frontend Apps

Two Node.js applications deployed to AKS cluster `josh-wood-otel` (resource group: `josh-wood-resource-grp`) in the `frontend-apps` namespace. OneAgent is injected automatically via the DynaKube operator, providing full RUM + server-side correlation.

| App | URL | Description |
|-----|-----|-------------|
| `trip-advisor` | `http://4.249.216.206` | Travel destination search and browsing |
| `trade-advisor` | `http://20.15.188.98` | Stock market analysis and portfolio viewer |

Both apps are pure Node.js HTTP servers defined in ConfigMaps — no build step, no external dependencies. HTML is generated server-side and served inline.

### Routes — trip-advisor
`/`, `/destinations`, `/search?q=<term>`, `/destination/<name>`, `/about`, `/dt-vision`

### Routes — trade-advisor
`/`, `/markets`, `/stock/<ticker>`, `/portfolio`, `/analysis`, `/analysis?type=technical`, `/analysis?type=news`, `/about`, `/dt-vision`

---

## dt-vision

A browser vision agent that accepts a natural-language goal and autonomously navigates the Dynatrace UI using Playwright + Claude vision.

### Quickstart

```bash
cd dt-vision
cp .env.template .env
# fill in DT_USERNAME, DT_PASSWORD, DT_ENV, DT_TENANT, ANTHROPIC_API_KEY
npm install
npx playwright install chromium --with-deps
node cli.js "Navigate to the Users & Sessions app and show me recent sessions for trip-advisor"
```

### Environment Variables (`.env`)

| Variable | Description |
|----------|-------------|
| `DT_ENV` | Tenant URL, e.g. `https://qof78400.apps.dynatrace.com` |
| `DT_TENANT` | Tenant ID, e.g. `qof78400` |
| `DT_USERNAME` | Dynatrace login email |
| `DT_PASSWORD` | Dynatrace login password |
| `DT_HEADLESS` | `false` to show browser window (default: `true`) |
| `ANTHROPIC_API_KEY` | Claude API key for vision mode |
| `DT_MAX_STEPS` | Max agent steps (default: 15) |
| `DT_ARTIFACTS_DIR` | Screenshot output directory |

### RUM Traffic Generation

```bash
node dt-vision/generate-rum-traffic.js
```

Runs two rounds of page visits across both demo apps in a fresh incognito Chromium context (anti-bot-detection flags enabled). Saves screenshots to `dt-vision/artifacts/`.

### IAM Setup

```bash
cd dt-vision
node setup-iam-playwright.js
```

Logs into the Dynatrace tenant via SSO, then creates the three policies above, creates matching groups, binds policies to groups, and adds the target user to all groups — all via authenticated browser-session API calls.

---

## Findings Report

`readout.md` documents a self-hosted LLM observability investigation on NVIDIA RTX 1000 Ada / A10G hardware with Ollama + Qwen models reporting into Dynatrace `qof78400`. Key topics:

- **GPU Observability Stack**: NVML Python shipper (32 metrics), Node.js proxy with OTel spans
- **VRAM Event Classification**: 3-tier magnitude classifier (model unload / eviction / KV compaction)
- **KV Cache Scaling**: ~0.143 MiB/token for qwen3:8b; practical context cap discovery via VRAM plateau
- **TTFT Linearity**: R² from OLS regression as a GPU health signal
- **Energy Cost**: NVML hardware counters, J/tok methodology, ~0.04 J/decode token on A10G
- **Context Persistence Middleware**: Dynamic threshold middleware that summarizes + compresses session history before hitting the context cap

---

## Prerequisites

- Node.js 18+
- kubectl configured against `josh-wood-otel` AKS cluster (for K8s manifests)
- Playwright Chromium: `npx playwright install chromium --with-deps`
- Dynatrace tenant admin credentials
