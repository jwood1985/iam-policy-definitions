#!/usr/bin/env node
import 'dotenv/config';
import { runDTVisionTask, planGoal } from './agent.js';
import { notifyPlan, notifyStep, notifyDone, notifyError } from './notify.js';

const goal = process.argv.slice(2).join(' ').trim();
if (!goal) {
  console.error('Usage: dt-vision "<goal>"');
  process.exit(1);
}

const ntfyOpts = process.env.NTFY_TOPIC
  ? { topic: process.env.NTFY_TOPIC }
  : {};

const config = {
  goal,
  tenant: process.env.DT_TENANT ?? undefined,
  tenantURL: process.env.DT_ENV ?? undefined,
  credentials: (process.env.DT_USERNAME && process.env.DT_PASSWORD)
    ? { username: process.env.DT_USERNAME, password: process.env.DT_PASSWORD }
    : undefined,
  dtToken: process.env.DT_TOKEN ?? undefined,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? undefined,
  model: process.env.DT_MODEL ?? undefined,
  headless: process.env.DT_HEADLESS !== 'false',
  maxSteps: process.env.DT_MAX_STEPS ? parseInt(process.env.DT_MAX_STEPS, 10) : undefined,
  artifactsDir: process.env.DT_ARTIFACTS_DIR ?? './artifacts',

  onStep: (info) => {
    const msg = `Step ${info.stepNum}: ${info.observation} (${info.goalProgress}%)`;
    if (info.action) console.log(`  → ${info.action.type}: ${info.action.target}`);
    notifyStep(msg, info.action ? `${info.action.type}: ${info.action.target}` : '', ntfyOpts).catch(() => {});
  },

  onDone: (summary) => {
    const text = [
      `Goal: ${summary.goal}`,
      `Steps: ${summary.stepsTotal}`,
      `Auth: ${summary.authSucceeded ? 'OK' : 'blocked'}`,
      `URL: ${summary.finalUrl}`,
      summary.observation ? `\n${summary.observation}` : '',
    ].filter(Boolean).join('\n');
    notifyDone(text, ntfyOpts).catch(() => {});
  },

  onError: (err) => {
    notifyError(`${err.message} (step ${err.step})`, ntfyOpts).catch(() => {});
  },
};

(async () => {
  try {
    await notifyPlan(goal, planGoal(goal), ntfyOpts).catch(() => {});
    await runDTVisionTask(config);
  } catch (err) {
    console.error('[cli] fatal:', err.message);
    process.exit(1);
  }
})();
