#!/usr/bin/env node
const https = require('https');

const DT_URL = 'qof78400.live.dynatrace.com';
const TOKEN = process.env.DT_API_TOKEN;

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

// Full web app body with all required fields
function makeWebAppBody(name) {
  return {
    name,
    realUserMonitoringEnabled: true,
    costControlUserSessionPercentage: 100,
    loadActionKeyPerformanceMetric: 'VISUALLY_COMPLETE',
    xhrActionKeyPerformanceMetric: 'ACTION_DURATION',
    conversionGoals: [],
    loadActionApdexSettings: {
      toleratedThreshold: 3000,
      frustratingThreshold: 12000,
      considerJavaScriptErrors: true
    },
    xhrActionApdexSettings: {
      toleratedThreshold: 2500,
      frustratingThreshold: 10000,
      considerJavaScriptErrors: false
    },
    customActionApdexSettings: {
      toleratedThreshold: 3000,
      frustratingThreshold: 12000,
      considerJavaScriptErrors: true
    },
    waterfallSettings: {
      uncompressedResourcesThreshold: 860,
      resourcesThreshold: 100000,
      resourceBrowserCachingThreshold: 50,
      slowFirstPartyResourceThreshold: 200000,
      slowThirdPartyResourceThreshold: 200000,
      slowCDNResourceThreshold: 200000,
      speedIndexVisuallyCompleteRatioThreshold: 50
    },
    monitoringSettings: {
      fetchRequests: true,
      xmlHttpRequest: true,
      javaScriptFrameworkSupport: {
        angular: true,
        dojo: false,
        extJS: false,
        icefaces: false,
        jquery: true,
        mootools: false,
        prototype: false,
        activeXObject: false
      },
      contentCapture: {
        resourceTimingSettings: {
          w3cResourceTimings: true,
          nonW3cResourceTimings: false,
          nonW3cResourceTimingsInstrumentationDelay: 50,
          resourceTimingCaptureType: 'CAPTURE_FULL_DETAILS',
          resourceTimingsDomainLimit: 10
        },
        javaScriptErrors: true,
        timeoutSettings: {
          timedActionSupport: false,
          temporaryActionLimit: 0,
          temporaryActionTotalTimeout: 100
        },
        visually_complete_and_speed_index: true
      },
      excludeXhrRegex: '',
      correlationHeaderInclusionRegex: '',
      injectionMode: 'JAVASCRIPT_TAG',
      addCrossOriginAnonymousAttribute: true,
      scriptTagCacheDurationInHours: 1,
      libraryFileLocation: '',
      monitoringDataPath: '',
      customConfigurationProperties: '',
      serverRequestPathId: '',
      secureCookieAttribute: false,
      cookiePlacementDomain: '',
      cacheControlHeaderOptimizations: true,
      advancedJavaScriptTagSettings: {
        syncBeaconFirefox: false,
        syncBeaconInternetExplorer: false,
        instrumentUnsupportedAjaxFrameworks: false,
        specialHandlingOfXhrRequestsContainingHtml: false,
        maxActionNameLength: 100,
        maxErrorsToCapture: 10,
        additionalEventHandlers: {
          userMouseupEventForClicks: false,
          clickEventHandler: false,
          mouseupEventHandler: false,
          blurEventHandler: false,
          changeEventHandler: false,
          toStringMethod: false,
          maxDomNodesToInstrument: 5000
        },
        eventWrapperSettings: {
          click: false,
          mouseUp: false,
          change: false,
          blur: false,
          touchStart: false,
          touchEnd: false
        },
        globalEventCaptureSettings: {
          mouseUp: true,
          mouseDown: true,
          click: true,
          doubleClick: true,
          keyUp: true,
          keyDown: true,
          scroll: true,
          additionalEventCapturedAsUserInput: ''
        }
      }
    },
    userActionAndSessionProperties: [],
    userTagsSettings: { tagManagerIdentity: '' },
    sessionReplaySettings: { enabled: true, costControlPercentage: 10, enableCssResourceCapturing: true, cssResourceCapturingExclusionRules: [] },
    rumInjectionMode: 'ALL_PAGES',
    keyUserActions: [],
    tags: [],
    metaDataCaptureSettings: [],
    browserRestrictionSettings: { mode: 'EXCLUDE', browserRestrictions: [] },
    ipAddressRestrictionSettings: { mode: 'EXCLUDE', ipAddressRestrictions: [] },
    javaScriptInjectionRules: []
  };
}

async function createOrGetApp(name) {
  // Try to create
  console.log(`Creating ${name}...`);
  let r = await req('POST', '/api/config/v1/applications/web', makeWebAppBody(name));
  if (r.s === 201) {
    console.log(`  Created: ${r.b.entityId}`);
    return r.b.entityId;
  } else if (r.s === 400) {
    console.log(`  400 Error: ${JSON.stringify(r.b).substring(0, 200)}`);
    return null;
  } else {
    console.log(`  ${r.s}: ${JSON.stringify(r.b).substring(0, 200)}`);
    return null;
  }
}

async function main() {
  const tripId = await createOrGetApp('trip-advisor');
  const tradeId = await createOrGetApp('trade-advisor');

  if (tripId && tradeId) {
    console.log(`\ntripId: ${tripId}`);
    console.log(`tradeId: ${tradeId}`);

    // Create app detection rules
    const TOKEN2 = process.env.DT_PLATFORM_TOKEN;
    console.log('\nCreating app detection rules...');
    for (const [ip, appId, name] of [['4.249.216.206', tripId, 'trip'], ['20.15.188.98', tradeId, 'trade']]) {
      const b = JSON.stringify([{ schemaId: 'builtin:rum.web.app-detection', scope: 'environment', value: { matcher: 'DOMAIN_MATCHES', pattern: ip, applicationId: appId } }]);
      const result = await new Promise((resolve, reject) => {
        const opts = { hostname: DT_URL, port: 443, path: '/api/v2/settings/objects', method: 'POST', headers: { 'Authorization': `Api-Token ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } };
        const r = https.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({s:res.statusCode,b:JSON.parse(d)})) });
        r.on('error',reject); r.write(b); r.end();
      });
      console.log(`  ${name} (${ip} -> ${appId}): ${result.s} ${JSON.stringify(result.b).substring(0, 80)}`);
    }
  }
}

main().catch(console.error);
