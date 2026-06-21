import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';

// Per-key client cache — avoids re-instantiating on every step
const clientCache = new Map();
function getClient(apiKey) {
  if (!clientCache.has(apiKey)) clientCache.set(apiKey, new Anthropic({ apiKey }));
  return clientCache.get(apiKey);
}

function buildSystemPrompt(config = {}) {
  const tenantURL = config.tenantURL ?? 'https://qof78400.apps.dynatrace.com';
  const vw = config.viewport?.width ?? 1280;
  const vh = config.viewport?.height ?? 800;

  return `You are a browser navigation agent analyzing screenshots of the Dynatrace Platform UI (${tenantURL}). The viewport is ${vw}x${vh}.

Your job is to understand what is currently visible on the screen and determine the next action needed to accomplish the user's goal. Many DT apps render inside iframes — use coordinate clicks to interact with them.

KNOWN APP: Smartscape (dynatrace.smartscape)
- Contains: Home, Smartscape on Grail, Infrastructure overview, Problem graph, Service dependency graph, Kubernetes overview, AWS EC2 ecosystem overview.
- Custom topology links are managed via Settings (builtin:topology.model.custom-type) or the DT REST API, not a separate Topology Builder app.

Respond ONLY with valid JSON in this format:
{
  "observation": "what you see on the screen",
  "goalProgress": "how far along we are toward the goal (0-100)",
  "nextAction": {
    "type": "click|coordinate|drag|navigate|input|scroll|screenshot|done|error",
    "target": "text to click, 'x,y' coordinates, 'x1,y1→x2,y2' for drag, URL path, 'x,y' or selector for input focus, 'up|down|left|right' for scroll, or description",
    "value": "(input only) text to type after focusing target",
    "reason": "why this action"
  },
  "isComplete": false
}

For "click": target is visible text to find and click in the outer page DOM.
For "coordinate": target is "x,y" pixel coordinates to click (use this for iframe app content).
For "drag": target is "x1,y1→x2,y2" pixel coordinates (source → destination).
For "navigate": target is a URL path (e.g. /ui/apps/dynatrace.automations).
For "input": target is "x,y" coordinates or visible text label of the field to focus; value is the text to type.
For "scroll": target is "up", "down", "left", or "right" — scrolls the current viewport.
For "screenshot": target is a label for the artifact.
For "done": goal is accomplished.
For "error": something went wrong and we cannot proceed.`;
}

export async function analyzeScreen(screenshotPath, goal, history = [], config = {}) {
  const apiKey = config.anthropicApiKey;
  if (!apiKey) throw new Error('anthropicApiKey required for vision analysis');

  const ai = getClient(apiKey);
  const imageData = await readFile(screenshotPath);
  const base64 = imageData.toString('base64');
  const mediaType = (screenshotPath.endsWith('.jpg') || screenshotPath.endsWith('.jpeg'))
    ? 'image/jpeg'
    : 'image/png';

  const historyText = history.length > 0
    ? `\n\nPrevious actions taken:\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
    : '';

  const response = await ai.messages.create({
    model: config.model ?? 'claude-opus-4-7',
    max_tokens: 1024,
    system: [{ type: 'text', text: buildSystemPrompt(config), cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: `Goal: ${goal}${historyText}\n\nWhat do you see and what should the next action be?` },
      ],
    }],
  });

  const text = response.content[0].text;
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/) || text.match(/(\{[\s\S]+\})/);
    return JSON.parse(jsonMatch ? jsonMatch[1] : text);
  } catch {
    return {
      observation: text,
      goalProgress: 0,
      nextAction: { type: 'screenshot', target: 'analysis-failed', reason: 'Could not parse AI response' },
      isComplete: false,
    };
  }
}

export async function describeScreenshot(screenshotPath, config = {}) {
  const apiKey = config.anthropicApiKey;
  if (!apiKey) throw new Error('anthropicApiKey required');

  const ai = getClient(apiKey);
  const imageData = await readFile(screenshotPath);
  const base64 = imageData.toString('base64');
  const mediaType = (screenshotPath.endsWith('.jpg') || screenshotPath.endsWith('.jpeg'))
    ? 'image/jpeg'
    : 'image/png';

  const response = await ai.messages.create({
    model: config.model ?? 'claude-opus-4-7',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Describe what is visible in this Dynatrace UI screenshot in 2-3 sentences.' },
      ],
    }],
  });

  return response.content[0].text;
}

// DOM-only fallback — no config needed, pure function
export function analyzeDOMContent(content, goal) {
  const { url, title, text, links, buttons } = content;
  const lowerGoal = goal.toLowerCase();
  const lowerText = text.toLowerCase();
  const lowerTitle = title.toLowerCase();

  const isLoginPage = lowerText.includes('sign in') || lowerText.includes('log in') || url.includes('sso');
  if (isLoginPage) {
    return {
      observation: `Login/SSO page detected at ${url}. Dynatrace Platform requires OAuth/SSO authentication.`,
      goalProgress: 5,
      nextAction: { type: 'error', target: 'auth-required', reason: 'UI requires SSO login' },
      isComplete: false,
    };
  }

  // Skip brand name and short/common words when matching goal keywords
  const SKIP = new Set(['dynatrace', 'show', 'find', 'give', 'with', 'from', 'that', 'this', 'have', 'been']);
  const goalKeywords = lowerGoal.split(/\W+/).filter(w => w.length >= 5 && !SKIP.has(w));

  // If the page title already matches, we're on target
  if (goalKeywords.some(w => lowerTitle.includes(w))) {
    return {
      observation: `On target page: "${title}" at ${url}.`,
      goalProgress: 90,
      nextAction: { type: 'done', target: 'current-page', reason: 'Goal page reached' },
      isComplete: true,
    };
  }

  // Find nav links matching goal keywords (skip brand/chrome links)
  const SKIP_LINKS = new Set(['dynatrace', 'home', 'support', 'collapse']);
  const relevantLinks = links.filter(l => {
    if (!l.text) return false;
    const lt = l.text.toLowerCase();
    if (SKIP_LINKS.has(lt)) return false;
    return goalKeywords.some(w => lt.includes(w));
  });

  if (relevantLinks.length > 0) {
    return {
      observation: `Found relevant link "${relevantLinks[0].text}" on "${title}" page`,
      goalProgress: 50,
      nextAction: { type: 'click', target: relevantLinks[0].text, reason: 'Most relevant link to goal' },
      isComplete: false,
    };
  }

  const isOnTarget = goalKeywords.some(w => lowerText.includes(w));
  return {
    observation: `On page: "${title}" (${url}). Goal keywords ${isOnTarget ? 'found' : 'not found'} in content.`,
    goalProgress: isOnTarget ? 70 : 20,
    nextAction: { type: 'screenshot', target: 'current-state', reason: 'Documenting current state' },
    isComplete: isOnTarget,
  };
}
