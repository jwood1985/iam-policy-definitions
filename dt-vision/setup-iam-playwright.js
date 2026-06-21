/**
 * setup-iam-playwright.js
 *
 * Uses the authenticated browser session (full admin context) to create
 * IAM policies and groups in the Dynatrace Gen3 platform, then adds
 * joshuadwood.phd@gmail.com to all three groups.
 *
 * Run:  node dt-vision/setup-iam-playwright.js
 */

import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import https from 'https';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Load .env manually (avoid dotenv dependency issues) ──────────────────────
function loadEnv() {
  try {
    const raw = readFileSync(join(__dir, '.env'), 'utf8');
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    return env;
  } catch { return {}; }
}

const env = loadEnv();
const TENANT_URL   = env.DT_ENV || 'https://qof78400.apps.dynatrace.com';
const USERNAME     = env.DT_USERNAME || 'joshuadwood.phd@gmail.com';
const PASSWORD     = env.DT_PASSWORD || '';
const USER_EMAIL   = 'joshuadwood.phd@gmail.com';
const HEADLESS     = env.DT_HEADLESS === 'false' ? false : true;

// ── Policy definitions ────────────────────────────────────────────────────────
const POLICIES = [
  {
    name: 'Standard User - Gen3',
    description: 'Standard Gen3 user policy with access to core platform features',
    statementQuery: `//States
ALLOW state:app-states:delete, state:app-states:read, state:app-states:write, state:user-app-states:read, state:user-app-states:write, state:user-app-states:delete, state-management:user-app-states:delete, state-management:user-app-states:delete-all;
//Documents
ALLOW document:documents:read, document:documents:write, document:documents:delete, document:environment-shares:read, document:environment-shares:write, document:environment-shares:claim, document:environment-shares:delete, document:direct-shares:read, document:direct-shares:write, document:direct-shares:delete, document:trash.documents:read, document:trash.documents:restore, document:trash.documents:delete;
//Unified analysis screens
ALLOW unified-analysis:screen-definition:read;
//Live Debugger
ALLOW dev-obs:breakpoints:set;
//Grail
ALLOW storage:bucket-definitions:read;
ALLOW storage:fieldset-definitions:read;
ALLOW storage:filter-segments:read, storage:filter-segments:write, storage:filter-segments:delete;
//OpenPipeline
ALLOW openpipeline:configurations:read;
//Hub
ALLOW hub:catalog:read;
//AppEngine
ALLOW app-engine:apps:run, app-engine:functions:run, app-engine:edge-connects:read;
//Notifications
ALLOW email:emails:send, notification:self-notifications:read, notification:self-notifications:write, notification:notifications:read, notification:notifications:write;
//AutomationEngine
ALLOW automation:workflows:read, automation:calendars:read, automation:rules:read;
ALLOW automation:workflows:write WHERE automation:workflow-type = "SIMPLE";
ALLOW automation:workflows:run;
//Davis
ALLOW davis:analyzers:read, davis:analyzers:execute;
//Davis Copilot
ALLOW davis-copilot:conversations:execute, davis-copilot:nl2dql:execute, davis-copilot:dql2nl:execute, davis-copilot:document-search:execute;
//Settings
ALLOW settings:objects:read, settings:schemas:read, app-settings:objects:read;
//Classics
ALLOW environment:roles:viewer, environment:roles:view-security-problems;
//Geolocations
ALLOW geolocation:locations:lookup;
// Vulnerability service
ALLOW vulnerability-service:vulnerabilities:read;
// Security Intelligence Service
ALLOW security-intelligence:enrichments:run;
//SLOs
ALLOW slo:slos:read, slo:objective-templates:read;
//BusinessInsights
ALLOW insights:opportunities:read;
ALLOW insights:moments:read;
//Extensions
ALLOW extensions:definitions:read;
// Business Analytics service
ALLOW business-analytics:business-flows:read;`,
  },
  {
    name: 'Gen3 RUM Foundation',
    description: 'RUM foundation policy with read access to user sessions, replays and events',
    statementQuery: `ALLOW storage:user.replays:read;
ALLOW storage:buckets:read WHERE storage:bucket-name IN ("default_web_user_replays", "default_mobile_user_replays", "default_user_error_events", "default_user_events", "default_user_sessions");
ALLOW session-replay:resources:read;
ALLOW storage:events:read;
ALLOW storage:entities:read;`,
  },
  {
    name: 'Gen3 RUM Policy \u2013 Restricted by App',
    description: 'RUM policy with user session and event read access, restricted by application',
    statementQuery: `ALLOW storage:user.sessions:read;
ALLOW storage:user.events:read;`,
  },
];

// ── Login via SSO ─────────────────────────────────────────────────────────────
async function login(page) {
  console.log(`[login] navigating to ${TENANT_URL}`);
  await page.goto(TENANT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const url = page.url();
  if (!url.includes('sso.dynatrace.com') && !url.includes('/login')) {
    console.log('[login] already authenticated');
    return;
  }

  console.log(`[login] SSO page detected — logging in as ${USERNAME}`);

  // Helper: find the frame containing a given selector (iframes are common in SSO)
  async function findFrame(selector) {
    for (const frame of page.frames()) {
      try {
        if (await frame.locator(selector).count() > 0) {
          console.log(`[login] found "${selector}" in frame: ${frame.url().substring(0, 80)}`);
          return frame;
        }
      } catch {}
    }
    return page;
  }

  // Wait for the email field (searches all frames)
  await page.waitForSelector('input[type="email"]', { timeout: 12000 });
  await page.waitForTimeout(500);

  const emailFrame = await findFrame('input[type="email"]');

  // Check if this is a single-page form (both email + password visible at once)
  const pwdVisible = await emailFrame.locator('input[type="password"]').first().isVisible().catch(() => false);

  if (pwdVisible) {
    // Single-page: fill both, click Sign In once
    console.log('[login] single-page form detected');
    await emailFrame.locator('input[type="email"]').first().fill(USERNAME);
    const pwdSingle = emailFrame.locator('input[type="password"]').first();
    await pwdSingle.click();
    await pwdSingle.pressSequentially(PASSWORD, { delay: 30 });
    const submitBtns = emailFrame.locator('button[type="submit"]');
    const count = await submitBtns.count();
    await submitBtns.nth(count - 1).click();
  } else {
    // Two-step: email → Next → password → Sign in
    console.log('[login] two-step form detected');
    await emailFrame.locator('input[type="email"]').first().fill(USERNAME);
    await emailFrame.locator('button[type="submit"]').first().click();
    // Wait for password field (searches all frames), then find its containing frame
    await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 12000 });
    await page.waitForTimeout(800);
    const pwdFrame = await findFrame('input[type="password"]');
    const pwdInput = pwdFrame.locator('input[type="password"]').first();

    // Debug: inspect the field before typing
    console.log(`[login] PASSWORD length: ${PASSWORD.length}, last char code: ${PASSWORD.charCodeAt(PASSWORD.length-1)}`);
    const pwdDebug = await pwdFrame.evaluate(() => {
      const inp = document.querySelector('input[type="password"]');
      if (!inp) return 'not found';
      return { type: inp.type, readOnly: inp.readOnly, disabled: inp.disabled, placeholder: inp.placeholder, value: inp.value };
    });
    console.log('[login] password field debug:', JSON.stringify(pwdDebug));

    // Take a pre-fill screenshot
    await page.screenshot({ path: join(__dir, 'artifacts', 'iam-pre-fill.png') }).catch(() => {});

    // Try React native setter — check value BEFORE and AFTER events
    const setResult = await pwdFrame.evaluate((pwd) => {
      const input = document.querySelector('input[type="password"]');
      if (!input) return 'no-input';
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, pwd);
      const afterSet = input.value.length;   // before events
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const afterEvents = input.value.length; // after events
      return `pwdLen=${pwd.length} afterSet=${afterSet} afterEvents=${afterEvents}`;
    }, PASSWORD);
    console.log(`[login] React setter result: ${setResult}`);

    // Fallback: also click+type in case React setter didn't register
    const afterEventsLen = parseInt((setResult.match(/afterEvents=(\d+)/) || [])[1] || '0');
    if (afterEventsLen === 0) {
      await pwdInput.click();
      await pwdInput.pressSequentially(PASSWORD, { delay: 30 });
      const pwdLen2 = await pwdInput.inputValue().catch(() => '?');
      console.log(`[login] fallback pressSequentially value length: ${typeof pwdLen2 === 'string' ? pwdLen2.length : pwdLen2}`);
    }

    await pwdFrame.locator('button[type="submit"]').last().click();
  }

  // Wait up to 60s for any navigation away from sso.dynatrace.com
  // (handles account-picker, "stay signed in?", MFA, etc.)
  const tenantHost = new URL(TENANT_URL).hostname;
  try {
    await page.waitForURL(
      u => { try { return new URL(u).hostname === tenantHost; } catch { return false; } },
      { timeout: 60000 }
    );
    console.log('[login] authenticated:', page.url());
    return;
  } catch (_) { /* fall through */ }

  // Take a screenshot to diagnose where we are
  const shot = join(__dir, 'artifacts', 'iam-login-debug.png');
  await page.screenshot({ path: shot }).catch(() => {});
  console.log(`[login] still on: ${page.url()} — screenshot saved: ${shot}`);

  // If there's a "use another account" or account-picker link, click it
  const altAccount = page.locator('a, button').filter({ hasText: /use another|switch account|sign in with/i }).first();
  if (await altAccount.isVisible().catch(() => false)) {
    await altAccount.click();
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.locator('input[type="email"]').first().fill(USERNAME);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(
      u => { try { return new URL(u).hostname === tenantHost; } catch { return false; } },
      { timeout: 60000 }
    );
    console.log('[login] authenticated (2nd attempt):', page.url());
  } else {
    // Just wait a bit more — might be redirecting
    await page.waitForURL(
      u => { try { return new URL(u).hostname === tenantHost; } catch { return false; } },
      { timeout: 30000 }
    );
    console.log('[login] authenticated (delayed):', page.url());
  }
}

// ── Fetch helper that runs inside the browser page context ────────────────────
// Use Node.js https with session cookies — fully navigation-independent
async function pageFetch(cookies, method, path, body) {
  const url = path.startsWith('http') ? path : `${TENANT_URL}${path}`;
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const payload = body ? JSON.stringify(body) : null;
  const parsed = new URL(url);
  return new Promise((resolve) => {
    const opts = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Cookie': cookieHeader,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(d); } catch { json = { raw: d.slice(0, 500) }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Step helpers ──────────────────────────────────────────────────────────────
async function getAccountUuid(page) {
  console.log('\n[1] Getting account UUID…');
  // Wait for any post-login redirect to settle
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  // Try a few likely paths
  const candidates = [
    '/platform/v1/account',
    '/platform/iam/v1/account',
    '/api/v2/environments/qof78400',
  ];
  for (const p of candidates) {
    const r = await pageFetch(page, 'GET', p);
    if (r.status < 400) {
      const uuid = r.body?.accountUuid || r.body?.account?.uuid || r.body?.id;
      if (uuid) { console.log(`  → accountUuid: ${uuid}`); return uuid; }
    }
  }
  // Try intercepting the account info from the platform UI
  const r2 = await pageFetch(page, 'GET', '/platform/iam/v1/organizational-levels?pageSize=5');
  if (r2.status < 400) {
    const items = r2.body?.items || [];
    const acct = items.find(i => i.levelType === 'account' || i.type === 'account');
    if (acct?.id) { console.log(`  → accountUuid from org levels: ${acct.id}`); return acct.id; }
  }
  return null;
}

async function createPolicy(page, accountUuid, policy) {
  console.log(`\n  Creating policy "${policy.name}"…`);
  const paths = accountUuid
    ? [`/platform/iam/v1/organizational-levels/account/${accountUuid}/policies`]
    : [];
  // Also try environment-level (some tenants support this)
  paths.push(`/platform/iam/v1/organizational-levels/environment/qof78400/policies`);
  paths.push(`/platform/iam/v1/policies`);

  for (const path of paths) {
    const r = await pageFetch(page, 'POST', path, {
      name: policy.name,
      description: policy.description,
      statementQuery: policy.statementQuery,
    });
    if (r.status === 201 || r.status === 200) {
      const uuid = r.body?.uuid || r.body?.policyUuid;
      console.log(`  ✓ Created (HTTP ${r.status}) UUID: ${uuid}  via ${path}`);
      return uuid;
    }
    if (r.status === 409) {
      console.log(`  ⚠ Already exists at ${path} — fetching UUID…`);
      return fetchExistingPolicy(page, accountUuid, policy.name, path.replace('/policies', ''));
    }
    console.log(`  ✗ ${path} → HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  throw new Error(`Could not create policy "${policy.name}"`);
}

async function fetchExistingPolicy(cookies, accountUuid, name, basePath) {
  const r = await pageFetch(cookies, 'GET', `${basePath}/policies`);
  if (r.status < 400) {
    const items = r.body?.items || r.body?.policies || [];
    const found = items.find(p => p.name === name);
    if (found) return found.uuid || found.policyUuid;
  }
  throw new Error(`Policy "${name}" not found after 409`);
}

async function createGroup(page, accountUuid, name) {
  console.log(`\n  Creating group "${name}"…`);
  const paths = accountUuid
    ? [`/platform/iam/v1/organizational-levels/account/${accountUuid}/groups`]
    : [];
  // Also try environment-level
  paths.push(`/platform/iam/v1/organizational-levels/environment/qof78400/groups`);

  for (const path of paths) {
    const r = await pageFetch(page, 'POST', path, {
      name,
      description: `Group for policy: ${name}`,
    });
    if (r.status === 201 || r.status === 200) {
      const uuid = r.body?.uuid || r.body?.groupUuid || r.body?.id;
      console.log(`  ✓ Created (HTTP ${r.status}) UUID: ${uuid}  via ${path}`);
      return uuid;
    }
    if (r.status === 409) {
      console.log(`  ⚠ Already exists at ${path} — fetching UUID…`);
      return fetchExistingGroup(page, accountUuid, name, path.replace('/groups', ''));
    }
    console.log(`  ✗ ${path} → HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  throw new Error(`Could not create group "${name}"`);
}

async function fetchExistingGroup(cookies, accountUuid, name, basePath) {
  const r = await pageFetch(cookies, 'GET', `${basePath}/groups?partialGroupName=${encodeURIComponent(name)}&pageSize=50`);
  if (r.status < 400) {
    const items = r.body?.items || r.body?.groups || [];
    const found = items.find(g => g.name === name);
    if (found) return found.uuid || found.id;
  }
  throw new Error(`Group "${name}" not found after 409`);
}

async function bindPolicyToGroup(page, accountUuid, groupUuid, policyUuid) {
  console.log(`\n  Binding policy ${policyUuid} → group ${groupUuid}…`);
  const paths = accountUuid
    ? [
        `/platform/iam/v1/groups/${groupUuid}/bindings/account/${accountUuid}/policies`,
        `/platform/iam/v1/organizational-levels/account/${accountUuid}/groups/${groupUuid}/policies`,
      ]
    : [];
  paths.push(
    `/platform/iam/v1/groups/${groupUuid}/bindings/environment/qof78400/policies`,
    `/platform/iam/v1/organizational-levels/environment/qof78400/groups/${groupUuid}/policies`,
  );
  for (const path of paths) {
    const r = await pageFetch(page, 'POST', path, { policies: [policyUuid] });
    if (r.status < 400 || r.status === 409) {
      console.log(`  ✓ Bound (HTTP ${r.status})  via ${path}`);
      return;
    }
    console.log(`  ✗ ${path} → HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  throw new Error(`Could not bind policy ${policyUuid} to group ${groupUuid}`);
}

async function addUserToGroup(page, groupUuid, groupName) {
  console.log(`\n  Adding ${USER_EMAIL} → group "${groupName}"…`);
  const paths = [
    `/platform/iam/v1/groups/${groupUuid}/users`,
    `/platform/iam/v1/organizational-levels/environment/qof78400/groups/${groupUuid}/users`,
  ];
  for (const path of paths) {
    const r = await pageFetch(page, 'POST', path, { users: [{ email: USER_EMAIL }] });
    if (r.status < 400 || r.status === 409) {
      console.log(`  ✓ User added (HTTP ${r.status})  via ${path}`);
      return;
    }
    // Try PUT
    const rp = await pageFetch(page, 'PUT', path, { users: [{ email: USER_EMAIL }] });
    if (rp.status < 400 || rp.status === 409) {
      console.log(`  ✓ User added via PUT (HTTP ${rp.status})  via ${path}`);
      return;
    }
    console.log(`  ✗ ${path} → HTTP ${r.status} (POST) / ${rp.status} (PUT): ${JSON.stringify(rp.body).slice(0, 120)}`);
  }
  throw new Error(`Could not add user to group "${groupName}"`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' Dynatrace IAM Setup (browser-authenticated)');
  console.log(` Tenant: ${TENANT_URL}`);
  console.log(` Target user: ${USER_EMAIL}`);
  console.log('═══════════════════════════════════════════════════════');

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--no-sandbox',
      '--incognito',
      '--disable-features=PasswordManager,AutofillAssistant,AutofillCreditCard,AutofillProfile',
      '--disable-save-password-bubble',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: undefined,   // no saved cookies/localStorage
  });
  const page    = await context.newPage();

  // Capture any fetch errors in the page
  page.on('console', msg => {
    if (msg.type() === 'error') console.error('[page-err]', msg.text().slice(0, 150));
  });

  try {
    // Login
    await login(page);

    // Wait for the tenant app to fully settle before making API calls
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Probe account UUID (needed for account-level policies)
    const accountUuid = await getAccountUuid(page);
    if (!accountUuid) console.log('  ⚠ Could not determine accountUuid — will try env-level paths');

    // Create policies
    console.log('\n[2] Creating policies…');
    const policyUuids = [];
    for (const policy of POLICIES) {
      const uuid = await createPolicy(page, accountUuid, policy);
      policyUuids.push(uuid);
    }

    // Create groups
    console.log('\n[3] Creating groups…');
    const groupUuids = [];
    for (const policy of POLICIES) {
      const uuid = await createGroup(page, accountUuid, policy.name);
      groupUuids.push(uuid);
    }

    // Bind policies → groups
    console.log('\n[4] Binding policies to groups…');
    for (let i = 0; i < POLICIES.length; i++) {
      await bindPolicyToGroup(page, accountUuid, groupUuids[i], policyUuids[i]);
    }

    // Add user to all groups
    console.log('\n[5] Adding user to groups…');
    for (let i = 0; i < POLICIES.length; i++) {
      await addUserToGroup(page, groupUuids[i], POLICIES[i].name);
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(' Done! Summary:');
    for (let i = 0; i < POLICIES.length; i++) {
      console.log(`\n  "${POLICIES[i].name}"`);
      console.log(`    policyUuid: ${policyUuids[i]}`);
      console.log(`    groupUuid:  ${groupUuids[i]}`);
    }
    console.log(`\n  User ${USER_EMAIL} added to all groups.`);
    console.log('═══════════════════════════════════════════════════════');
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error('\n✗ Fatal:', e.message); process.exit(1); });
