#!/usr/bin/env node
'use strict';

const https = require('https');

// ── Config ────────────────────────────────────────────────────────────────────
const PLATFORM_TOKEN = 'process.env.DT_PLATFORM_TOKEN';
const TENANT_ID     = 'qof78400';
const USER_EMAIL    = 'joshuadwood.phd@gmail.com';
const IAM_HOST      = 'api.dynatrace.com';

// ── Policy definitions ────────────────────────────────────────────────────────
const POLICIES = [
  {
    name: 'Standard User - Gen3',
    description: 'Standard Gen3 user policy with access to core platform features',
    statementQuery: `
//States
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
ALLOW business-analytics:business-flows:read;
`.trim(),
  },
  {
    name: 'Gen3 RUM Foundation',
    description: 'RUM foundation policy with read access to user sessions, replays and events',
    statementQuery: `
ALLOW storage:user.replays:read;
ALLOW storage:buckets:read WHERE storage:bucket-name IN ("default_web_user_replays", "default_mobile_user_replays", "default_user_error_events", "default_user_events", "default_user_sessions");
ALLOW session-replay:resources:read;
ALLOW storage:events:read;
ALLOW storage:entities:read;
`.trim(),
  },
  {
    name: 'Gen3 RUM Policy \u2013 Restricted by App',
    description: 'RUM policy with user session and event read access, restricted by application',
    statementQuery: `
ALLOW storage:user.sessions:read;
ALLOW storage:user.events:read;
`.trim(),
  },
];

// ── HTTP helper ───────────────────────────────────────────────────────────────
function apiRequest(method, path, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const reqOpts = {
      hostname: IAM_HOST,
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${PLATFORM_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...opts.headers,
      },
    };
    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function ok(res) { return res.status >= 200 && res.status < 300; }

// ── Steps ─────────────────────────────────────────────────────────────────────
async function getAccountUuid() {
  console.log('\n[1] Fetching account UUID …');
  const res = await apiRequest('GET', '/accounts/v1/accounts');
  if (!ok(res)) {
    throw new Error(`accounts/v1/accounts → HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  }
  const items = res.body.items ?? res.body;
  if (!items || !items.length) throw new Error('No accounts returned');
  // Pick the account that owns qof78400, or fall back to first
  const match = items.find(a =>
    (a.environments ?? []).some(e => (e.id ?? e.environmentId ?? '') === TENANT_ID)
  ) ?? items[0];
  console.log(`  → accountUuid: ${match.accountUuid}  (name: ${match.name})`);
  return match.accountUuid;
}

async function createPolicy(accountUuid, policy) {
  const path = `/iam/v1/repo/account/${accountUuid}/policies`;
  console.log(`\n  Creating policy "${policy.name}" …`);
  const res = await apiRequest('POST', path, {
    name: policy.name,
    description: policy.description,
    statementQuery: policy.statementQuery,
  });
  if (!ok(res)) {
    // 409 = already exists; try to fetch existing
    if (res.status === 409) {
      console.log(`  ⚠ Policy already exists — fetching existing UUID …`);
      return fetchExistingPolicy(accountUuid, policy.name);
    }
    throw new Error(`createPolicy "${policy.name}" → HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  }
  const uuid = res.body.uuid ?? res.body.policyUuid;
  console.log(`  ✓ Policy UUID: ${uuid}`);
  return uuid;
}

async function fetchExistingPolicy(accountUuid, name) {
  const res = await apiRequest('GET', `/iam/v1/repo/account/${accountUuid}/policies`);
  if (!ok(res)) throw new Error(`listPolicies → HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  const items = res.body.items ?? res.body.policies ?? [];
  const found = items.find(p => p.name === name);
  if (!found) throw new Error(`Policy "${name}" not found after 409`);
  console.log(`  ✓ Existing policy UUID: ${found.uuid}`);
  return found.uuid;
}

async function createGroup(accountUuid, name) {
  console.log(`\n  Creating group "${name}" …`);
  const res = await apiRequest('POST', `/iam/v1/repo/groups?account-uuid=${accountUuid}`, {
    name,
    description: `Group for policy: ${name}`,
    federatedAttributeValues: [],
    owner: 'LOCAL',
  });
  if (!ok(res)) {
    if (res.status === 409) {
      console.log(`  ⚠ Group already exists — fetching existing UUID …`);
      return fetchExistingGroup(accountUuid, name);
    }
    throw new Error(`createGroup "${name}" → HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  }
  const uuid = res.body.uuid ?? res.body.groupUuid;
  console.log(`  ✓ Group UUID: ${uuid}`);
  return uuid;
}

async function fetchExistingGroup(accountUuid, name) {
  const res = await apiRequest('GET', `/iam/v1/repo/groups?account-uuid=${accountUuid}`);
  if (!ok(res)) throw new Error(`listGroups → HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  const items = res.body.items ?? res.body.groups ?? [];
  const found = items.find(g => g.name === name);
  if (!found) throw new Error(`Group "${name}" not found after 409`);
  console.log(`  ✓ Existing group UUID: ${found.uuid}`);
  return found.uuid;
}

async function bindPolicyToGroup(groupUuid, policyUuid) {
  // Bind at the environment (tenant) level so it applies to qof78400
  const path = `/iam/v1/repo/groups/${groupUuid}/bindings/environment/${TENANT_ID}/policies`;
  console.log(`\n  Binding policy ${policyUuid} → group ${groupUuid} (env: ${TENANT_ID}) …`);
  const res = await apiRequest('POST', path, { policies: [policyUuid] });
  if (!ok(res) && res.status !== 409) {
    throw new Error(`bindPolicy → HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  }
  console.log(`  ✓ Bound  (HTTP ${res.status})`);
}

async function addUserToGroup(groupUuid, groupName) {
  console.log(`\n  Adding user ${USER_EMAIL} → group "${groupName}" …`);
  // Try PUT /groups/{uuid}/users first (replaces whole membership)
  // Use POST to add without replacing
  const path = `/iam/v1/repo/groups/${groupUuid}/users`;
  const res = await apiRequest('POST', path, { users: [{ email: USER_EMAIL }] });
  if (!ok(res)) {
    // Some versions use PUT; try that
    const resPut = await apiRequest('PUT', path, { users: [{ email: USER_EMAIL }] });
    if (!ok(resPut) && resPut.status !== 409) {
      throw new Error(`addUser → HTTP ${res.status} (POST) / ${resPut.status} (PUT): ${JSON.stringify(resPut.body)}`);
    }
    console.log(`  ✓ User added via PUT (HTTP ${resPut.status})`);
    return;
  }
  console.log(`  ✓ User added (HTTP ${res.status})`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' Dynatrace IAM Policy + Group Setup');
  console.log(` Tenant: ${TENANT_ID}   User: ${USER_EMAIL}`);
  console.log('═══════════════════════════════════════════════════════');

  // 1. Get account UUID
  const accountUuid = await getAccountUuid();

  // 2. Create policies
  console.log('\n[2] Creating policies …');
  const policyUuids = [];
  for (const policy of POLICIES) {
    const uuid = await createPolicy(accountUuid, policy);
    policyUuids.push(uuid);
  }

  // 3. Create groups (one per policy)
  console.log('\n[3] Creating groups …');
  const groupUuids = [];
  for (const policy of POLICIES) {
    const uuid = await createGroup(accountUuid, policy.name);
    groupUuids.push(uuid);
  }

  // 4. Bind each policy to its group
  console.log('\n[4] Binding policies to groups …');
  for (let i = 0; i < POLICIES.length; i++) {
    await bindPolicyToGroup(groupUuids[i], policyUuids[i]);
  }

  // 5. Add user to all groups
  console.log('\n[5] Adding user to all groups …');
  for (let i = 0; i < POLICIES.length; i++) {
    await addUserToGroup(groupUuids[i], POLICIES[i].name);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' Done! Summary:');
  for (let i = 0; i < POLICIES.length; i++) {
    console.log(`\n  Policy: "${POLICIES[i].name}"`);
    console.log(`    policyUuid: ${policyUuids[i]}`);
    console.log(`    groupUuid:  ${groupUuids[i]}`);
  }
  console.log('\n  User added to all groups: ' + USER_EMAIL);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('\n✗ Fatal:', e.message);
  process.exit(1);
});
