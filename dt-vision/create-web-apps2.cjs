#!/usr/bin/env node
const https = require('https');

const DT_URL = 'qof78400.live.dynatrace.com';
const TOKENS = {
  otel: process.env.DT_API_TOKEN,
  op:   process.env.DT_TOKEN_OP,
  plat: process.env.DT_PLATFORM_TOKEN
};

function dtRequest(token, method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: DT_URL,
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Api-Token ${token}`,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
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
  // Try each token to create a web app via Config API v1
  const webAppBody = {
    name: 'trip-advisor',
    realUserMonitoringEnabled: true,
    costControlUserSessionPercentage: 100,
    loadActionKeyPerformanceMetric: 'VISUALLY_COMPLETE',
    xhrActionKeyPerformanceMetric: 'ACTION_DURATION',
    conversionGoals: []
  };

  console.log('=== Testing Config API v1 write with each token ===');
  for (const [name, tok] of Object.entries(TOKENS)) {
    const r = await dtRequest(tok, 'POST', '/api/config/v1/applications/web', webAppBody);
    console.log(`${name}: ${r.status} -> ${JSON.stringify(r.body).substring(0, 120)}`);
  }

  console.log('\n=== Testing Settings API v2 write with each token ===');
  const settingsBody = [{ schemaId: 'builtin:rum.web.name', scope: 'APPLICATION-AA11BB22CC33DD44', value: { applicationName: 'trip-advisor' } }];
  for (const [name, tok] of Object.entries(TOKENS)) {
    const r = await dtRequest(tok, 'POST', '/api/v2/settings/objects', settingsBody);
    console.log(`${name}: ${r.status} -> ${JSON.stringify(r.body).substring(0, 120)}`);
  }
}

main().catch(console.error);
