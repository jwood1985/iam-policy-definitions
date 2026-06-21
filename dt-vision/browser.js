import { chromium } from 'playwright';
import { mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';

export class DTBrowser {
  constructor({
    headless = true,
    token = null,
    tenantURL = 'https://qof78400.apps.dynatrace.com',
    viewport = { width: 1280, height: 800 },
    screenshotFormat = 'jpeg',
    screenshotQuality = 80,
    artifactsDir = './artifacts',
  } = {}) {
    this.headless = headless;
    this.token = token;
    this.tenantURL = tenantURL.replace(/\/$/, '');
    this.viewport = viewport;
    this.screenshotFormat = screenshotFormat;
    this.screenshotQuality = screenshotQuality;
    this.artifactsDir = artifactsDir;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.screenshotCount = 0;
  }

  async launch() {
    await mkdir(this.artifactsDir, { recursive: true });

    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--incognito',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    this.context = await this.browser.newContext({
      viewport: this.viewport,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      storageState: undefined,
    });

    // Mask automation fingerprint
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    if (this.token) {
      await this.context.route('**/api/**', async (route) => {
        const headers = { ...route.request().headers(), 'Authorization': `Api-Token ${this.token}` };
        await route.continue({ headers });
      });
    }

    this.page = await this.context.newPage();
    this.page.on('console', msg => {
      if (msg.type() === 'error') console.error('[browser error]', msg.text().slice(0, 120));
    });

    return this;
  }

  async navigate(url) {
    const target = url.startsWith('http') ? url : `${this.tenantURL}${url}`;
    console.log(`[browser] navigate to ${target}`);
    await this.page.goto(target, { waitUntil: 'load', timeout: 30000 });
  }

  async screenshot(label = 'page') {
    if (this.page.isClosed()) {
      console.warn(`[browser] screenshot skipped: page closed (${label})`);
      return { path: null, filename: `${label}.${this.screenshotFormat === 'jpeg' ? 'jpg' : 'png'}`, url: '', sizeBytes: 0 };
    }
    const ext = this.screenshotFormat === 'jpeg' ? 'jpg' : 'png';
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${ts}_${label}.${ext}`;
    const fullPath = join(this.artifactsDir, filename);

    const opts = {
      path: fullPath,
      type: this.screenshotFormat,
      timeout: 10000,
      ...(this.screenshotFormat === 'jpeg' ? { quality: this.screenshotQuality } : {}),
    };

    let saved = false;
    try {
      await this.page.screenshot({ ...opts, fullPage: true });
      saved = true;
    } catch {
      try {
        await this.page.screenshot({ ...opts, fullPage: false });
        saved = true;
      } catch {}
    }

    this.screenshotCount++;
    if (saved) {
      const { size } = await stat(fullPath).catch(() => ({ size: 0 }));
      console.log(`[browser] screenshot saved: ${filename} (${Math.round(size / 1024)}kb)`);
      return { path: fullPath, filename, url: this.page.url(), sizeBytes: size };
    }

    console.warn(`[browser] screenshot failed: ${filename}`);
    return { path: null, filename, url: this.page.url(), sizeBytes: 0 };
  }

  // Capture a buffer without saving — used for action verification
  async _screenshotBuffer() {
    const opts = {
      type: this.screenshotFormat,
      ...(this.screenshotFormat === 'jpeg' ? { quality: this.screenshotQuality } : {}),
    };
    return this.page.screenshot(opts).catch(() => Buffer.alloc(0));
  }

  async clickAt(x, y) {
    console.log(`[browser] clicking at: (${x}, ${y})`);
    try {
      await this.page.mouse.click(x, y);
      await this.page.waitForTimeout(1000);
      return true;
    } catch (e) {
      console.warn(`[browser] coordinate click failed: ${e.message}`);
      return false;
    }
  }

  // Click and verify something visually changed. Returns { clicked, changed }.
  async clickAtAndVerify(x, y) {
    const hash = buf => createHash('md5').update(buf).digest('hex');
    const before = await this._screenshotBuffer();
    await this.clickAt(x, y);
    await this.page.waitForTimeout(800);
    const after = await this._screenshotBuffer();
    const changed = hash(before) !== hash(after);
    if (!changed) console.warn(`[browser] action-verify: click at (${x},${y}) had no visible effect`);
    return { clicked: true, changed };
  }

  async dragAndDrop(x1, y1, x2, y2) {
    console.log(`[browser] drag: (${x1},${y1}) → (${x2},${y2})`);
    try {
      await this.page.mouse.move(x1, y1);
      await this.page.mouse.down();
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        await this.page.mouse.move(
          x1 + ((x2 - x1) * i) / steps,
          y1 + ((y2 - y1) * i) / steps
        );
      }
      await this.page.mouse.up();
      await this.page.waitForTimeout(500);
      return true;
    } catch (e) {
      console.warn(`[browser] drag failed: ${e.message}`);
      return false;
    }
  }

  async typeText(text) {
    console.log(`[browser] typing: "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`);
    await this.page.keyboard.type(text, { delay: 30 });
    await this.page.waitForTimeout(400);
  }

  async scroll(direction, amount = 400) {
    console.log(`[browser] scroll: ${direction} ${amount}px`);
    const map = { up: [0, -amount], down: [0, amount], left: [-amount, 0], right: [amount, 0] };
    const [dx, dy] = map[direction] ?? [0, amount];
    await this.page.mouse.wheel(dx, dy);
    await this.page.waitForTimeout(600);
  }

  async clickText(text) {
    console.log(`[browser] clicking: "${text}"`);
    try {
      await this.page.getByText(text, { exact: false }).first().click({ timeout: 5000 });
      await this.page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  async getPageContent() {
    if (this.page.isClosed()) {
      return { url: '', title: 'Page closed', text: '', links: [], buttons: [] };
    }
    const url = this.page.url();
    const title = await this.page.title();
    const text = await this.page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '');

    // Extract content from iframes — Playwright can access cross-origin frames via CDP
    let iframeText = '';
    for (const frame of this.page.frames()) {
      if (frame === this.page.mainFrame()) continue;
      try {
        const ft = await frame.evaluate(() => document.body?.innerText?.slice(0, 2000) || '');
        if (ft.trim()) iframeText += '\n[iframe]: ' + ft;
      } catch {}
    }

    const links = await this.page.evaluate(() =>
      [...document.querySelectorAll('a[href]')].slice(0, 30).map(a => ({
        text: a.innerText.trim().slice(0, 60),
        href: a.href,
      }))
    );
    const buttons = await this.page.evaluate(() =>
      [...document.querySelectorAll('button, [role="button"], [data-dt-action]')]
        .slice(0, 20)
        .map(b => ({ text: b.innerText?.trim().slice(0, 60) || b.getAttribute('aria-label') || '', type: b.tagName }))
    );
    return { url, title, text: text + iframeText, links, buttons };
  }

  async close() {
    if (this.browser) await this.browser.close();
  }
}
