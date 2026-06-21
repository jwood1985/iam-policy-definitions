import { DTBrowser } from './browser.js';
import { analyzeScreen, analyzeDOMContent, describeScreenshot } from './vision.js';
import { getToken, getEnvironmentURL, getProblems, getServices, getDashboards } from './dtctl.js';
import { handleSSO, getAuthHint } from './auth.js';

const DT_UI_PATHS = {
  home: '/ui',
  problems: '/ui/apps/dynatrace.davis.problems',
  services: '/ui/apps/dynatrace.infraops',
  dashboards: '/ui/apps/dynatrace.dashboards',
  logs: '/ui/apps/dynatrace.logs',
  notebooks: '/ui/apps/dynatrace.notebooks',
  automations: '/ui/apps/dynatrace.automations',
  releases: '/ui/apps/dynatrace.releases',
  settings: '/ui/apps/dynatrace.settings',
  smartscape: '/ui/apps/dynatrace.smartscape',
};

function normalizeTenantURL(tenant) {
  if (!tenant) return null;
  if (tenant.startsWith('http')) return tenant.replace(/\/$/, '');
  return `https://${tenant}.apps.dynatrace.com`;
}

function buildConfig(userConfig) {
  return {
    goal: userConfig.goal,
    tenantURL: normalizeTenantURL(userConfig.tenant) ?? userConfig.tenantURL ?? null,
    credentials: userConfig.credentials ?? null,
    dtToken: userConfig.dtToken ?? null,
    anthropicApiKey: userConfig.anthropicApiKey ?? null,
    model: userConfig.model ?? 'claude-opus-4-7',
    viewport: userConfig.viewport ?? { width: 1280, height: 800 },
    screenshotFormat: userConfig.screenshotFormat ?? 'jpeg',
    screenshotQuality: userConfig.screenshotQuality ?? 80,
    theme: userConfig.theme ?? 'light',
    headless: userConfig.headless ?? true,
    maxSteps: userConfig.maxSteps ?? 15,
    iframeWaitMs: userConfig.iframeWaitMs ?? 8000,
    artifactsDir: userConfig.artifactsDir ?? './artifacts',
    onStep: userConfig.onStep ?? null,
    onDone: userConfig.onDone ?? null,
    onError: userConfig.onError ?? null,
  };
}

export function planGoal(goal) {
  const lowerGoal = goal.toLowerCase();
  const steps = [
    'Retrieve Dynatrace tenant config and API token',
    'Launch Chromium browser (headless) with Playwright',
    'Navigate to Dynatrace Platform UI',
    'Authenticate via SSO if credentials provided, else attempt token injection',
    'Take initial screenshot as artifact',
  ];

  if (lowerGoal.includes('problem') || lowerGoal.includes('alert')) {
    steps.push('Navigate to Davis AI Problems app', 'Screenshot problem list and details');
  } else if (lowerGoal.includes('service') || lowerGoal.includes('infra')) {
    steps.push('Navigate to Services / Infrastructure Ops', 'Screenshot services list');
  } else if (lowerGoal.includes('dashboard')) {
    steps.push('Navigate to Dashboards app', 'Screenshot dashboard list');
  } else if (lowerGoal.includes('topology builder') || lowerGoal.includes('smartscape')) {
    steps.push('Navigate to Smartscape app', 'Explore topology views and entity relationships');
  } else if (lowerGoal.includes('log')) {
    steps.push('Navigate to Logs & Events app', 'Screenshot logs view');
  } else {
    steps.push(`Navigate toward goal: "${goal}"`, 'Screenshot target page');
  }

  steps.push(
    'Analyze page with AI vision (Claude) or DOM-only fallback',
    'Execute navigation and interaction actions toward goal',
    'Document all screenshots as artifacts',
    'Invoke onDone callback with summary'
  );
  return steps;
}

function findBestStartPath(goal) {
  const lower = goal.toLowerCase();
  if (lower.includes('topology builder') || lower.includes('smartscape')) return DT_UI_PATHS.smartscape;
  if (lower.includes('problem') || lower.includes('alert') || lower.includes('incident')) return DT_UI_PATHS.problems;
  if (lower.includes('log')) return DT_UI_PATHS.logs;
  if (lower.includes('notebook')) return DT_UI_PATHS.notebooks;
  if (lower.includes('automation') || lower.includes('workflow')) return DT_UI_PATHS.automations;
  if (lower.includes('dashboard')) return DT_UI_PATHS.dashboards;
  if (lower.includes('setting')) return DT_UI_PATHS.settings;
  if (lower.includes('service') || lower.includes('infra')) return DT_UI_PATHS.services;
  return DT_UI_PATHS.home;
}

async function gatherAPIContext(goal) {
  const lower = goal.toLowerCase();
  const data = {};
  try {
    if (lower.includes('problem') || lower.includes('alert')) {
      data.problems = await getProblems();
    } else if (lower.includes('service') || lower.includes('infra')) {
      data.services = await getServices();
    } else if (lower.includes('dashboard')) {
      data.dashboards = await getDashboards();
    }
  } catch (e) {
    console.warn('[agent] API context fetch failed:', e.message);
  }
  return data;
}

/**
 * Run a Dynatrace UI automation task using browser vision.
 *
 * @param {object} userConfig
 * @param {string} userConfig.goal             Natural-language task description (required)
 * @param {string} [userConfig.tenant]         Tenant ID or full URL, e.g. 'qof78400' or 'https://qof78400.apps.dynatrace.com'
 * @param {object} [userConfig.credentials]   { username, password } for SSO login
 * @param {string} [userConfig.dtToken]        Dynatrace API token (for API context; auth uses credentials)
 * @param {string} [userConfig.anthropicApiKey] Enables Claude vision mode; falls back to DOM-only without it
 * @param {string} [userConfig.model]          Claude model (default: 'claude-opus-4-7')
 * @param {object} [userConfig.viewport]       { width, height } (default: { width: 1280, height: 800 })
 * @param {string} [userConfig.screenshotFormat] 'jpeg' | 'png' (default: 'jpeg')
 * @param {number} [userConfig.screenshotQuality] JPEG quality 1-100 (default: 80)
 * @param {boolean} [userConfig.headless]      (default: true)
 * @param {number} [userConfig.maxSteps]       (default: 15)
 * @param {number} [userConfig.iframeWaitMs]   Wait after auth before first screenshot (default: 8000)
 * @param {string} [userConfig.artifactsDir]   Where to save screenshots (default: './artifacts')
 * @param {function} [userConfig.onStep]       Called after each step with stepInfo
 * @param {function} [userConfig.onDone]       Called on successful completion with summary
 * @param {function} [userConfig.onError]      Called on fatal error with { message, step }
 * @returns {Promise<object>}                  Summary object (same payload as onDone)
 */
export async function runDTVisionTask(userConfig) {
  const config = buildConfig(userConfig);

  if (!config.goal) throw new Error('config.goal is required');

  // Resolve tenant URL: config → dtctl → fallback
  if (!config.tenantURL) {
    const dtctlURL = await getEnvironmentURL();
    config.tenantURL = dtctlURL ?? 'https://qof78400.apps.dynatrace.com';
  }

  console.log(`\n=== dt-vision ===`);
  console.log(`Goal: ${config.goal}`);
  console.log(`Tenant: ${config.tenantURL}`);
  console.log(`Vision: ${config.anthropicApiKey ? `Claude (${config.model})` : 'DOM-only'}`);
  console.log(`Viewport: ${config.viewport.width}x${config.viewport.height} ${config.screenshotFormat.toUpperCase()}\n`);

  config.onStep?.({ stepNum: 0, observation: 'Plan ready', goalProgress: 0, action: null, screenshot: null, isComplete: false });

  // Resolve API token — prefer config, fall back to dtctl
  let token = config.dtToken ?? (await getToken());
  console.log(`[agent] token: ${token ? token.slice(0, 20) + '...' : 'NOT FOUND'}`);

  // Gather API-level context in parallel (best-effort, non-blocking)
  const apiContext = await gatherAPIContext(config.goal);
  if (Object.keys(apiContext).length > 0) {
    console.log('[agent] API context retrieved:', Object.keys(apiContext));
  }

  const startPath = findBestStartPath(config.goal);
  console.log(`[agent] starting at: ${config.tenantURL}${startPath}`);

  const browser = new DTBrowser({
    headless: config.headless,
    token,
    tenantURL: config.tenantURL,
    viewport: config.viewport,
    screenshotFormat: config.screenshotFormat,
    screenshotQuality: config.screenshotQuality,
    artifactsDir: config.artifactsDir,
  });

  await browser.launch();

  const artifacts = [];
  const history = [];
  let stepCount = 0;
  let authSucceeded = false;

  try {
    await browser.navigate(`${config.tenantURL}${startPath}`);

    // Check for SSO redirect
    const currentURL = browser.page.url();
    if (currentURL.includes('sso.dynatrace.com') || currentURL.includes('/login')) {
      console.log('[agent] SSO redirect detected — attempting auth');
      authSucceeded = await handleSSO(browser.page, token, config);
      if (!authSucceeded) console.log('[auth hint]:', getAuthHint());
    } else {
      authSucceeded = true;
    }

    // After SSO, navigate to the intended destination if we landed elsewhere
    const postAuthURL = browser.page.url();
    const tenantHost = new URL(config.tenantURL).hostname;
    if (authSucceeded && !postAuthURL.includes(tenantHost)) {
      await browser.navigate(`${config.tenantURL}${startPath}`).catch(e => console.warn('[agent] re-navigate:', e.message));
    } else if (authSucceeded && !postAuthURL.includes(startPath.split('/').pop())) {
      await browser.navigate(`${config.tenantURL}${startPath}`).catch(e => console.warn('[agent] re-navigate:', e.message));
    }

    // Allow slow iframe apps time to render before first screenshot
    console.log(`[agent] waiting ${config.iframeWaitMs}ms for app to render...`);
    await new Promise(r => setTimeout(r, config.iframeWaitMs));

    let shot = await browser.screenshot('initial');
    artifacts.push(shot);
    history.push(`Navigated to ${config.tenantURL}${startPath}`);

    config.onStep?.({
      stepNum: 0,
      observation: `Browser launched. URL: ${browser.page.url()} | Auth: ${authSucceeded ? 'OK' : 'blocked (SSO)'}`,
      goalProgress: 5,
      action: null,
      screenshot: shot,
      isComplete: false,
    });

    const hasVision = !!config.anthropicApiKey;
    console.log(`[agent] vision mode: ${hasVision ? 'Claude AI' : 'DOM-only'}\n`);

    while (stepCount < config.maxSteps) {
      stepCount++;
      console.log(`\n[agent] --- Step ${stepCount}/${config.maxSteps} ---`);

      if (browser.page.isClosed()) {
        console.warn('[agent] page closed unexpectedly — stopping');
        break;
      }

      shot = await browser.screenshot(`step-${stepCount}`);
      artifacts.push(shot);

      let analysis;
      if (hasVision && shot.path) {
        try {
          analysis = await analyzeScreen(shot.path, config.goal, history, config);
        } catch (e) {
          console.warn('[agent] vision API error:', e.message);
          const content = await browser.getPageContent();
          analysis = analyzeDOMContent(content, config.goal);
        }
      } else {
        const content = await browser.getPageContent();
        analysis = analyzeDOMContent(content, config.goal);
      }

      console.log(`[agent] observation: ${analysis.observation}`);
      console.log(`[agent] progress:    ${analysis.goalProgress}%`);
      console.log(`[agent] next action: ${analysis.nextAction?.type} → ${analysis.nextAction?.target}`);

      config.onStep?.({
        stepNum: stepCount,
        observation: analysis.observation,
        goalProgress: analysis.goalProgress,
        action: analysis.nextAction,
        screenshot: shot,
        isComplete: analysis.isComplete ?? false,
      });

      if (analysis.isComplete || analysis.nextAction?.type === 'done') {
        console.log('[agent] Goal accomplished!');
        break;
      }

      if (analysis.nextAction?.type === 'error') {
        console.log(`[agent] Cannot proceed: ${analysis.nextAction.reason}`);
        if (!authSucceeded) console.log('\n' + getAuthHint());
        break;
      }

      if (analysis.nextAction?.type === 'screenshot') {
        // Just wait and re-screenshot — useful when an app is still loading
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      const action = analysis.nextAction;
      history.push(`${action.type}: ${action.target} — ${action.reason}`);

      if (action.type === 'click') {
        const clicked = await browser.clickText(action.target);
        if (!clicked) {
          for (const [key, path] of Object.entries(DT_UI_PATHS)) {
            if (action.target.toLowerCase().includes(key)) {
              await browser.navigate(`${config.tenantURL}${path}`);
              break;
            }
          }
        }
      } else if (action.type === 'coordinate') {
        const [x, y] = action.target.split(',').map(n => parseInt(n.trim(), 10));
        if (!isNaN(x) && !isNaN(y)) {
          const result = await browser.clickAtAndVerify(x, y);
          if (!result.changed) {
            history.push(`[warn] coordinate click at ${x},${y} had no visible effect`);
          }
        }
      } else if (action.type === 'drag') {
        // Format: "x1,y1→x2,y2"
        const [from, to] = action.target.split('→').map(s => s.trim());
        const [x1, y1] = from.split(',').map(n => parseInt(n.trim(), 10));
        const [x2, y2] = to.split(',').map(n => parseInt(n.trim(), 10));
        if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
          await browser.dragAndDrop(x1, y1, x2, y2);
        }
      } else if (action.type === 'input') {
        const coords = (action.target ?? '').match(/^(\d+)\s*,\s*(\d+)$/);
        if (coords) {
          await browser.clickAt(parseInt(coords[1], 10), parseInt(coords[2], 10));
        } else if (action.target) {
          await browser.clickText(action.target);
        }
        if (action.value) await browser.typeText(action.value);
      } else if (action.type === 'scroll') {
        await browser.scroll(action.target ?? 'down');
      } else if (action.type === 'navigate') {
        const target = action.target.startsWith('http') ? action.target : `${config.tenantURL}${action.target}`;
        await browser.navigate(target);
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    shot = await browser.screenshot('final');
    artifacts.push(shot);

    let finalDescription = '';
    if (config.anthropicApiKey && shot.path) {
      try {
        finalDescription = await describeScreenshot(shot.path, config);
      } catch {}
    }

    const apiSummary = Object.entries(apiContext)
      .map(([k, v]) => `  ${k}: ${v?.result?.length ?? v?.length ?? '?'} items (from dtctl)`)
      .join('\n');

    const summary = {
      success: true,
      goal: config.goal,
      stepsTotal: stepCount,
      screenshots: artifacts,
      finalUrl: browser.page.url(),
      observation: finalDescription,
      authSucceeded,
      apiSummary,
    };

    const summaryText = [
      `Goal: ${config.goal}`,
      `Auth: ${authSucceeded ? 'browser session established' : 'blocked — SSO requires credentials'}`,
      `Steps taken: ${stepCount}`,
      `Screenshots: ${artifacts.length} (saved to ${config.artifactsDir})`,
      `Final URL: ${summary.finalUrl}`,
      apiSummary ? `\nAPI data retrieved:\n${apiSummary}` : '',
      finalDescription ? `\nFinal screen: ${finalDescription}` : '',
    ].filter(Boolean).join('\n');

    console.log('\n=== Summary ===\n' + summaryText);
    config.onDone?.(summary);
    return summary;

  } catch (err) {
    console.error('[agent] Fatal error:', err);
    config.onError?.({ message: err.message, step: stepCount });
    throw err;
  } finally {
    await browser.close();
  }
}
