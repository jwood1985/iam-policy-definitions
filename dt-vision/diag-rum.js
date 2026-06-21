import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const issues = [];
page.on('response', resp => {
  if (resp.status() >= 400) {
    issues.push(`[${resp.status()}] ${resp.url()}`);
  }
});

console.log('Visiting trip-advisor...');
await page.goto('http://4.249.216.206/', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(5000);

console.log('\n=== URLs with 4xx responses ===');
for (const u of issues) console.log(u);
console.log(`Total issues: ${issues.length}`);
await browser.close();
