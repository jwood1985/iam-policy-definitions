import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const DTCTL = '/root/.local/bin/dtctl';

export async function runDtctl(...args) {
  try {
    const { stdout, stderr } = await execFileAsync(DTCTL, [...args, '-o', 'json'], {
      timeout: 30000,
      env: { ...process.env },
    });
    try { return JSON.parse(stdout); } catch { return { raw: stdout, stderr }; }
  } catch (e) {
    return { error: e.message, stderr: e.stderr };
  }
}

export async function getServices() {
  return runDtctl('entities', 'list', '--type', 'SERVICE');
}

export async function getProblems() {
  return runDtctl('problems', 'list');
}

export async function getDashboards() {
  return runDtctl('documents', 'list', '--type', 'dashboard');
}

export async function getToken() {
  const config = await runDtctl('config', 'view');
  const tokens = config?.Tokens ?? config?.result?.Tokens;
  return tokens?.[0]?.Token ?? null;
}

// Returns null if dtctl has no environment configured — callers should fall back to config.tenantURL
export async function getEnvironmentURL() {
  const config = await runDtctl('config', 'view');
  const contexts = config?.Contexts ?? config?.result?.Contexts;
  return contexts?.[0]?.Context?.Environment ?? null;
}
