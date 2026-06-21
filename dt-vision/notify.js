import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const https = require('https');

const DEFAULT_TOPIC = 'the-goggles-they-do-nothing-2';
const DEFAULT_BASE = 'https://ntfy.sh';

export async function notify(message, opts = {}) {
  const {
    title = 'dt-vision',
    priority = 'default',
    tags = [],
    topic = DEFAULT_TOPIC,
    base = DEFAULT_BASE,
  } = opts;

  const url = new URL(`${base}/${topic}`);
  const body = typeof message === 'string' ? message : JSON.stringify(message, null, 2);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname,
        headers: {
          'Title': title,
          'Priority': priority,
          'Tags': tags.join(','),
          'Content-Type': 'text/plain',
        },
      },
      (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function notifyPlan(goal, steps, ntfyOpts = {}) {
  const body = `GOAL: ${goal}\n\nPLAN:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`;
  return notify(body, { title: 'dt-vision: Plan', priority: 'high', tags: ['brain', 'eyes'], ...ntfyOpts });
}

export async function notifyStep(step, detail = '', ntfyOpts = {}) {
  return notify(detail ? `${step}\n${detail}` : step, { title: 'dt-vision: Step', tags: ['arrow_right'], ...ntfyOpts });
}

export async function notifyDone(summary, ntfyOpts = {}) {
  return notify(summary, { title: 'dt-vision: Done', priority: 'high', tags: ['white_check_mark'], ...ntfyOpts });
}

export async function notifyError(err, ntfyOpts = {}) {
  return notify(String(err), { title: 'dt-vision: Error', priority: 'urgent', tags: ['x'], ...ntfyOpts });
}
