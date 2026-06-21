#!/usr/bin/env node
const https = require('https');

const DT_URL = 'qof78400.live.dynatrace.com';
const TOKEN = process.env.DT_API_TOKEN;

// Hex-valid APPLICATION entity IDs (must be 16 uppercase hex chars after APPLICATION-)
const TRIP_APP_ID = 'APPLICATION-FEEDBEEF0001AAAA';
const TRADE_APP_ID = 'APPLICATION-FEEDBEEF0002AAAA';
const TRIP_IP = '4.249.216.206';
const TRADE_IP = '20.15.188.98';

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

async function upsertSettings(objects) {
  const r = await req('POST', '/api/v2/settings/objects', objects);
  return r;
}

async function main() {
  console.log('=== Setting up DT web applications for frontend-apps ===\n');

  // 1. Create web application names (creates APPLICATION entities if they don't exist)
  console.log('Creating trip-advisor application entity...');
  let r = await upsertSettings([{
    schemaId: 'builtin:rum.web.name',
    scope: TRIP_APP_ID,
    value: { applicationName: 'trip-advisor' }
  }]);
  console.log(`  ${r.s}: ${JSON.stringify(r.b).substring(0, 80)}`);

  console.log('Creating trade-advisor application entity...');
  r = await upsertSettings([{
    schemaId: 'builtin:rum.web.name',
    scope: TRADE_APP_ID,
    value: { applicationName: 'trade-advisor' }
  }]);
  console.log(`  ${r.s}: ${JSON.stringify(r.b).substring(0, 80)}`);

  // 2. Enable RUM for both apps (builtin:rum.web.enablement)
  console.log('\nEnabling RUM for trip-advisor...');
  r = await upsertSettings([{
    schemaId: 'builtin:rum.web.enablement',
    scope: TRIP_APP_ID,
    value: { enableRealUserMonitoring: true, costControlUserSessionPercentage: 100 }
  }]);
  console.log(`  ${r.s}: ${JSON.stringify(r.b).substring(0, 100)}`);

  console.log('Enabling RUM for trade-advisor...');
  r = await upsertSettings([{
    schemaId: 'builtin:rum.web.enablement',
    scope: TRADE_APP_ID,
    value: { enableRealUserMonitoring: true, costControlUserSessionPercentage: 100 }
  }]);
  console.log(`  ${r.s}: ${JSON.stringify(r.b).substring(0, 100)}`);

  // 3. Create app detection rules
  console.log('\nCreating app detection rule for trip-advisor IP...');
  r = await upsertSettings([{
    schemaId: 'builtin:rum.web.app-detection',
    scope: 'environment',
    value: {
      matcher: 'DOMAIN_MATCHES',
      pattern: TRIP_IP,
      applicationId: TRIP_APP_ID
    }
  }]);
  console.log(`  ${r.s}: ${JSON.stringify(r.b).substring(0, 150)}`);

  console.log('Creating app detection rule for trade-advisor IP...');
  r = await upsertSettings([{
    schemaId: 'builtin:rum.web.app-detection',
    scope: 'environment',
    value: {
      matcher: 'DOMAIN_MATCHES',
      pattern: TRADE_IP,
      applicationId: TRADE_APP_ID
    }
  }]);
  console.log(`  ${r.s}: ${JSON.stringify(r.b).substring(0, 150)}`);

  // 4. Verify entities were created
  console.log('\n=== Verifying created entities ===');
  r = await req('GET', `/api/v2/settings/objects?schemaIds=builtin:rum.web.name&scopes=${TRIP_APP_ID}`);
  if (r.b.items && r.b.items.length > 0) {
    console.log(`trip-advisor: ${JSON.stringify(r.b.items[0].value)}`);
  }
  r = await req('GET', `/api/v2/settings/objects?schemaIds=builtin:rum.web.name&scopes=${TRADE_APP_ID}`);
  if (r.b.items && r.b.items.length > 0) {
    console.log(`trade-advisor: ${JSON.stringify(r.b.items[0].value)}`);
  }

  console.log('\n=== Done! ===');
  console.log(`trip-advisor APPLICATION ID: ${TRIP_APP_ID}`);
  console.log(`trade-advisor APPLICATION ID: ${TRADE_APP_ID}`);
  console.log('\nWait ~30s then check if RUM JS is being injected:');
  console.log(`  curl http://${TRIP_IP}/ | grep -i dtrum`);
}

main().catch(console.error);
