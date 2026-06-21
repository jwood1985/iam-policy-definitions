#!/usr/bin/env node
const https = require('https');

const DT_URL = 'qof78400.live.dynatrace.com';
const TOKEN = 'process.env.DT_API_TOKEN';
const TRIP_APP_ID = 'APPLICATION-FEEDBEEF0001AAAA';
const TRADE_APP_ID = 'APPLICATION-FEEDBEEF0002AAAA';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: DT_URL, port: 443, path, method,
      headers: {
        'Authorization': `Api-Token ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(b ? { 'Content-Length': Buffer.byteLength(b) } : {})
      }
    };
    const r = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ s: res.statusCode, b: JSON.parse(d) }); }
        catch { resolve({ s: res.statusCode, b: d }); }
      });
    });
    r.on('error', reject);
    if (b) r.write(b);
    r.end();
  });
}

async function applySettings(scope, schemaId, value) {
  const r = await req('POST', '/api/v2/settings/objects', [{ schemaId, scope, value }]);
  const status = Array.isArray(r.b) ? r.b[0].code : r.s;
  const msg = Array.isArray(r.b) ? JSON.stringify(r.b[0]).substring(0, 100) : JSON.stringify(r.b).substring(0, 100);
  console.log(`  ${schemaId} -> ${status}: ${msg}`);
  return r;
}

async function configureApp(appId, appName) {
  console.log(`\n=== Configuring ${appName} (${appId}) ===`);

  // Enable RUM with correct schema format (copied from working app APPLICATION-F9BFAB945F05B17B)
  await applySettings(appId, 'builtin:rum.web.enablement', {
    rum: { enabled: true, costAndTrafficControl: 100 },
    sessionReplay: { enabled: true, costAndTrafficControl: 100 }
  });

  // Set injection format to "Code Snippet" (inline) like the working app
  await applySettings(appId, 'builtin:rum.web.automatic-injection', {
    monitoringCodeSourceSection: { codeSource: 'OneAgent' },
    snippetFormat: { snippetFormat: 'Code Snippet', codeSnippetType: 'DEFERRED' },
    cacheControlHeaders: { cacheControlHeaders: true }
  });
}

async function main() {
  await configureApp(TRIP_APP_ID, 'trip-advisor');
  await configureApp(TRADE_APP_ID, 'trade-advisor');
  console.log('\n=== Done! Wait ~30s then re-test RUM JS injection ===');
}

main().catch(console.error);
