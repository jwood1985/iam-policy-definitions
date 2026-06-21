import 'dotenv/config';
import { DTBrowser } from './browser.js';

const TRIP_ADVISOR_URL = 'http://4.249.216.206';
const TRADE_ADVISOR_URL = 'http://20.15.188.98';

const TRIP_ROUTES = [
  '/',
  '/destinations',
  '/search?q=beach',
  '/search?q=mountains',
  '/destination/paris',
  '/destination/bali',
  '/destination/tokyo',
  '/about',
  '/dt-vision',
  '/destinations',
  '/',
];

const TRADE_ROUTES = [
  '/',
  '/markets',
  '/stock/AAPL',
  '/stock/NVDA',
  '/stock/TSLA',
  '/stock/MSFT',
  '/portfolio',
  '/analysis',
  '/analysis?type=technical',
  '/analysis?type=news',
  '/dt-vision',
  '/about',
  '/',
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function visitApp(browser, baseUrl, routes, appName) {
  console.log(`\n=== Generating RUM traffic for ${appName} (${baseUrl}) ===`);
  for (const route of routes) {
    const url = baseUrl + route;
    try {
      console.log(`  [${appName}] visiting ${route}`);
      await browser.navigate(url);
      await sleep(1500 + Math.random() * 1000);
      await browser.screenshot(`${appName}${route.replace(/[^a-z0-9]/gi, '_')}`);
    } catch (err) {
      console.error(`  [${appName}] error on ${route}: ${err.message}`);
    }
  }
  console.log(`  [${appName}] done - ${routes.length} pages visited`);
}

async function main() {
  const headless = process.env.DT_HEADLESS !== 'false' ? true : false;
  const artifactsDir = process.env.DT_ARTIFACTS_DIR || './artifacts';

  console.log('Starting RUM traffic generation...');
  console.log(`  headless: ${headless}`);
  console.log(`  trip-advisor: ${TRIP_ADVISOR_URL}`);
  console.log(`  trade-advisor: ${TRADE_ADVISOR_URL}`);

  const browser = new DTBrowser({
    headless,
    artifactsDir,
    viewport: { width: 1280, height: 900 },
  });

  await browser.launch();
  console.log('[browser] launched');

  try {
    // Round 1
    await visitApp(browser, TRIP_ADVISOR_URL, TRIP_ROUTES, 'trip-advisor');
    await sleep(2000);
    await visitApp(browser, TRADE_ADVISOR_URL, TRADE_ROUTES, 'trade-advisor');

    await sleep(3000);

    // Round 2 — second pass generates more session data
    console.log('\n=== Round 2: second pass ===');
    await visitApp(browser, TRIP_ADVISOR_URL, ['/', '/destinations', '/search?q=europe', '/destination/rome', '/dt-vision', '/about'], 'trip-advisor-r2');
    await sleep(2000);
    await visitApp(browser, TRADE_ADVISOR_URL, ['/', '/markets', '/stock/AMZN', '/stock/META', '/portfolio', '/dt-vision', '/analysis'], 'trade-advisor-r2');

  } finally {
    await browser.close();
    console.log('\n[browser] closed');
    console.log('RUM traffic generation complete!');
    console.log(`Screenshots saved to: ${artifactsDir}/`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
