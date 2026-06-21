export async function handleSSO(page, token, config = {}) {
  const url = page.url();
  const isSSO = url.includes('sso.dynatrace.com') || url.includes('/login');
  if (!isSSO) return false;

  console.log('[auth] SSO page detected — attempting authentication');

  const username = config.credentials?.username;
  const password = config.credentials?.password;

  if (username && password) {
    console.log(`[auth] using credentials for: ${username}`);
    try {
      // DT SSO is a two-step form: email → Next → password → Sign in
      await page.waitForSelector('input[type="email"]', { timeout: 8000 });
      await page.locator('input[type="email"]').first().fill(username);
      await page.locator('button[type="submit"]').first().click();

      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      await page.locator('input[type="password"]').first().fill(password);
      await page.locator('button[type="submit"]').first().click();

      // Wait for redirect to the tenant domain — use a function predicate so we
      // match the actual hostname, not occurrences in query-string goto params.
      let tenantHost;
      try { tenantHost = new URL(config.tenantURL).hostname; } catch { tenantHost = null; }
      const urlMatch = tenantHost
        ? (url) => { try { return new URL(url).hostname === tenantHost; } catch { return false; } }
        : /dynatrace\.com/;
      await page.waitForURL(urlMatch, { timeout: 20000 });
      await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});

      const newUrl = page.url();
      console.log(`[auth] credential login succeeded: ${newUrl}`);
      return true;
    } catch (e) {
      console.warn('[auth] credential login error:', e.message);
    }
  }

  // Fallback: inject API token into localStorage
  if (token && config.tenantURL) {
    try {
      console.log('[auth] attempting token injection into session');
      await page.goto(config.tenantURL, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      await page.evaluate((tok) => {
        ['dt:token', 'dtAuthToken', 'dt.auth.access_token', 'dt_auth_token', 'access_token']
          .forEach(k => localStorage.setItem(k, tok));
        sessionStorage.setItem('dt:auth:access_token', tok);
      }, token);
      await page.reload({ waitUntil: 'load', timeout: 15000 }).catch(() => {});
      const newUrl = page.url();
      const success = !newUrl.includes('sso.dynatrace.com');
      console.log(`[auth] token injection ${success ? 'succeeded' : 'failed'}: ${newUrl}`);
      return success;
    } catch (e) {
      console.warn('[auth] token injection failed:', e.message);
    }
  }

  console.log('[auth] all auth strategies exhausted');
  return false;
}

export function getAuthHint() {
  return `To authenticate the browser UI, provide credentials in the config:
  { credentials: { username: "your@email.com", password: "your-password" } }

Or set DT_USERNAME and DT_PASSWORD environment variables when using the CLI.`;
}
