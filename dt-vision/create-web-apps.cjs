#!/usr/bin/env node
// Create DT web application entities and app detection rules for trip-advisor and trade-advisor
const https = require('https');

const DT_URL = 'qof78400.live.dynatrace.com';
const TOKEN_OTEL = process.env.DT_API_TOKEN;
const TOKEN_OP = process.env.DT_TOKEN_OP;

function dtRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: DT_URL,
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Api-Token ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`${method} ${path} => ${res.statusCode}`);
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  // Step 1: Create web application entities via Settings 2.0
  // Try using Config v1 API first
  console.log('=== Creating web application entities ===');

  // Create trip-advisor web app
  const tripApp = {
    name: 'trip-advisor',
    realUserMonitoringEnabled: true,
    costControlUserSessionPercentage: 100,
    loadActionKeyPerformanceMetric: 'VISUALLY_COMPLETE',
    xhrActionKeyPerformanceMetric: 'ACTION_DURATION',
    conversionGoals: []
  };
  const tripResult = await dtRequest('POST', '/api/config/v1/applications/web', tripApp);
  console.log('trip-advisor create result:', JSON.stringify(tripResult.body));

  const tradeApp = { ...tripApp, name: 'trade-advisor' };
  const tradeResult = await dtRequest('POST', '/api/config/v1/applications/web', tradeApp);
  console.log('trade-advisor create result:', JSON.stringify(tradeResult.body));

  if (tripResult.status === 201 && tradeResult.status === 201) {
    const tripId = tripResult.body.entityId || tripResult.body.id;
    const tradeId = tradeResult.body.entityId || tradeResult.body.id;
    console.log(`trip-advisor APPLICATION ID: ${tripId}`);
    console.log(`trade-advisor APPLICATION ID: ${tradeId}`);

    // Step 2: Create app detection rules
    console.log('\n=== Creating app detection rules ===');
    const detectionRules = [
      { schemaId: 'builtin:rum.web.app-detection', scope: 'environment', value: { matcher: 'DOMAIN_MATCHES', pattern: '4.249.216.206', applicationId: tripId } },
      { schemaId: 'builtin:rum.web.app-detection', scope: 'environment', value: { matcher: 'DOMAIN_MATCHES', pattern: '20.15.188.98', applicationId: tradeId } }
    ];

    for (const rule of detectionRules) {
      const r = await dtRequest('POST', '/api/v2/settings/objects', [rule]);
      console.log(`Detection rule for ${rule.value.pattern}: ${JSON.stringify(r.body)}`);
    }
  } else {
    console.log('\nConfig API v1 failed (likely no WriteConfig scope). Trying alternative...');

    // Check if Settings 2.0 with scope works
    const testBody = [{ schemaId: 'builtin:rum.web.name', scope: 'APPLICATION-TRIP0000ADVIS0R01', value: { applicationName: 'trip-advisor' } }];
    const testResult = await dtRequest('POST', '/api/v2/settings/objects', testBody);
    console.log('Settings API test:', JSON.stringify(testResult.body));
  }
}

main().catch(console.error);
