// Builds public/source/kizashi-ephemeris-source.tar.gz (and its .sha256): every file Git tracks, plus a
// manifest naming the commit, so the deployed Worker serves exactly the source it was built from.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const files = git('ls-files').split('\n').filter(Boolean);
const dirty = git('status', '--porcelain', '--untracked-files=no');
if (dirty) throw new Error(`Commit the tracked changes before building the source archive:\n${dirty}`);
const commit = git('rev-parse', 'HEAD');

const stage = mkdtempSync(join(tmpdir(), 'kizashi-ephemeris-source-'));
const top = join(stage, 'kizashi-ephemeris');
try {
  for (const file of files) {
    mkdirSync(dirname(join(top, file)), { recursive: true });
    cpSync(join(root, file), join(top, file));
  }
  writeFileSync(join(top, 'SOURCE-MANIFEST.json'), JSON.stringify({ name: 'kizashi-ephemeris', commit, files }, null, 2) + '\n');
  const out = join(root, 'public', 'source');
  mkdirSync(out, { recursive: true });
  const archive = join(out, 'kizashi-ephemeris-source.tar.gz');
  // Fixed owner and order so the same commit gives the same archive.
  execFileSync('tar', ['-czf', archive, '--uid', '0', '--gid', '0', '-C', stage, 'kizashi-ephemeris'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const sha = createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(`${archive}.sha256`, `${sha}  kizashi-ephemeris-source.tar.gz\n`);
  console.log(`${files.length} files, commit ${commit.slice(0, 12)} → public/source/kizashi-ephemeris-source.tar.gz (${sha.slice(0, 12)})`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
