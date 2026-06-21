#!/usr/bin/env node
const https = require('https');

const DT_URL = 'qof78400.live.dynatrace.com';
const TOKEN = process.env.DT_API_TOKEN;
const PLAT_TOKEN = process.env.DT_PLATFORM_TOKEN;

function dtReq(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: DT_URL, port: 443, path, method,
      headers: {
        'Authorization': `Api-Token ${token || TOKEN}`,
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

const apdex = {
  toleratedThreshold: 3000,
  frustratingThreshold: 12000,
  toleratedFallbackThreshold: 3000,
  frustratingFallbackThreshold: 12000
};

function makeAppBody(name) {
  return {
    name,
    type: 'AUTO_INJECTED',
    realUserMonitoringEnabled: true,
    costControlUserSessionPercentage: 100,
    loadActionKeyPerformanceMetric: 'VISUALLY_COMPLETE',
    xhrActionKeyPerformanceMetric: 'VISUALLY_COMPLETE',
    loadActionApdexSettings: apdex,
    xhrActionApdexSettings: apdex,
    customActionApdexSettings: apdex,
    sessionReplayConfig: {
      enabled: true,
      costControlPercentage: 100,
      enableCssResourceCapturing: true,
      cssResourceCapturingExclusionRules: []
    },
    waterfallSettings: {
      uncompressedResourcesThreshold: 860,
      resourcesThreshold: 100000,
      resourceBrowserCachingThreshold: 50,
      slowFirstPartyResourcesThreshold: 200000,
      slowThirdPartyResourcesThreshold: 200000,
      slowCdnResourcesThreshold: 200000,
      speedIndexVisuallyCompleteRatioThreshold: 50
    },
    conversionGoals: [],
    monitoringSettings: {
      fetchRequests: true,
      xmlHttpRequest: true,
      javaScriptFrameworkSupport: {
        angular: false, dojo: false, extJS: false, icefaces: false,
        jQuery: false, mooTools: false, prototype: false, activeXObject: false
      },
      contentCapture: {
        resourceTimingSettings: {
          w3cResourceTimings: true,
          nonW3cResourceTimings: false,
          nonW3cResourceTimingsInstrumentationDelay: 50,
          resourceTimingCaptureType: null,
          resourceTimingsDomainLimit: 10
        },
        javaScriptErrors: true,
        timeoutSettings: {
          timedActionSupport: false,
          temporaryActionLimit: 0,
          temporaryActionTotalTimeout: 100
        },
        visuallyCompleteAndSpeedIndex: true
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
        specialCharactersToEscape: '',
        additionalEventHandlers: {
          userMouseupEventForClicks: false, clickEventHandler: false,
          mouseupEventHandler: false, blurEventHandler: false,
          changeEventHandler: false, toStringMethod: false,
          maxDomNodesToInstrument: 5000
        },
        eventWrapperSettings: {
          click: false, mouseUp: false, change: false,
          blur: false, touchStart: false, touchEnd: false
        },
        globalEventCaptureSettings: {
          mouseUp: true, mouseDown: true, click: true, doubleClick: true,
          keyUp: true, keyDown: true, scroll: true,
          additionalEventCapturedAsUserInput: ''
        }
      }
    },
    userActionNamingSettings: {
      placeholders: [],
      loadActionNamingRules: [],
      xhrActionNamingRules: [],
      customActionNamingRules: [],
      ignoreCase: true,
      useFirstDetectedLoadAction: false,
      splitUserActionsByDomain: true,
      queryParameterCleanups: ['cfid', 'phpsessid', '__sid', 'cftoken', 'sid']
    },
    userActionAndSessionProperties: [],
    userTagsSettings: { tagManagerIdentity: '' },
    rumInjectionMode: 'ALL_PAGES',
    keyUserActions: [],
    tags: [],
    metaDataCaptureSettings: [],
    browserRestrictionSettings: { mode: 'EXCLUDE', browserRestrictions: [] },
    ipAddressRestrictionSettings: { mode: 'EXCLUDE', ipAddressRestrictions: [] },
    javaScriptInjectionRules: []
  };
}

async function createApp(name) {
  const r = await dtReq('POST', '/api/config/v1/applications/web', makeAppBody(name));
  if (r.s === 201) {
    console.log(`  Created ${name}: response = ${JSON.stringify(r.b)}`);
    const id = r.b.entityId || r.b.id || r.b.identifier;
    console.log(`  Entity ID: ${id}`);
    return id;
  } else {
    const violations = r.b.error && r.b.error.constraintViolations;
    if (violations) {
      violations.forEach(v => console.log(`    VIOLATION: ${v.path}: ${v.message}`));
    } else {
      console.log(`  ${r.s}: ${JSON.stringify(r.b).substring(0, 200)}`);
    }
    return null;
  }
}

async function createDetectionRule(ip, appId) {
  const r = await dtReq('POST', '/api/v2/settings/objects', [{
    schemaId: 'builtin:rum.web.app-detection',
    scope: 'environment',
    value: { matcher: 'DOMAIN_MATCHES', pattern: ip, applicationId: appId }
  }]);
  const code = Array.isArray(r.b) ? r.b[0].code : r.s;
  console.log(`  Detection rule ${ip} -> ${appId}: ${code}`);
}

async function main() {
  console.log('=== Creating trip-advisor and trade-advisor web apps ===');

  // Delete old fake app detection rules first (for FEEDBEEF IDs)
  console.log('\nRemoving old detection rules...');
  const existing = await dtReq('GET', '/api/v2/settings/objects?schemaIds=builtin:rum.web.app-detection&pageSize=50');
  if (existing.b.items) {
    for (const item of existing.b.items) {
      const v = item.value;
      if ((v.pattern === '4.249.216.206' || v.pattern === '20.15.188.98') &&
          (v.applicationId.includes('FEEDBEEF') || v.applicationId.includes('AA11BB'))) {
        const del = await dtReq('DELETE', `/api/v2/settings/objects/${encodeURIComponent(item.objectId)}`);
        console.log(`  Deleted rule for ${v.pattern} (${v.applicationId}): ${del.s}`);
      }
    }
  }

  // Create web apps
  console.log('\nCreating web applications...');
  const tripId = await createApp('trip-advisor');
  const tradeId = await createApp('trade-advisor');

  if (tripId && tradeId) {
    console.log('\nCreating app detection rules...');
    await createDetectionRule('4.249.216.206', tripId);
    await createDetectionRule('20.15.188.98', tradeId);

    console.log('\n=== SUCCESS ===');
    console.log(`trip-advisor:  ${tripId}`);
    console.log(`trade-advisor: ${tradeId}`);
    console.log('\nNow wait ~60s for OneAgent to receive new UEM config, then re-run traffic');
  } else {
    console.log('\nFailed to create one or both apps. Check errors above.');
  }
}

main().catch(console.error);
