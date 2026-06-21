import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
console.log('__dir:', __dir);

const raw = readFileSync(join(__dir, '.env'), 'utf8');
console.log('.env length:', raw.length);
console.log('lines:', raw.split('\n').length);

const env = {};
for (const line of raw.split('\n')) {
  const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
  if (m) {
    const key = m[1];
    const val = m[2].replace(/^['"]|['"]$/g, '');
    env[key] = val;
    if (key === 'DT_PASSWORD') {
      console.log('DT_PASSWORD raw m[2]:', JSON.stringify(m[2]));
      console.log('DT_PASSWORD after replace:', JSON.stringify(val));
      console.log('DT_PASSWORD length:', val.length);
    }
  } else {
    // Show non-matching lines for debugging
    if (line.trim() && !line.startsWith('#')) {
      console.log('NON-MATCHING line:', JSON.stringify(line.substring(0, 30)));
    }
  }
}
console.log('All keys:', Object.keys(env).join(', '));
