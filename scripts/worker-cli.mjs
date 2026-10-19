import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const state = join(root, '.wrangler');
mkdirSync(state, { recursive: true });
mkdirSync(join(state, 'registry'), { recursive: true });
const child = spawn(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', env: {
    ...process.env,
    WRANGLER_REGISTRY_PATH: join(state, 'registry'),
    WRANGLER_LOG_PATH: join(state, 'wrangler.log'),
    WRANGLER_SEND_METRICS: 'false',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', (code, signal) => { process.exitCode = code ?? (signal ? 130 : 1); });
