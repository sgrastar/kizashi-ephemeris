// Builds public/source/kizashi-ephemeris-source.tar.gz (and its .sha256), the source of the Worker this
// directory deploys: every file Git tracks plus SOURCE-MANIFEST.json naming the commit. The archive is
// written here (ustar + gzip, no system tar), with fixed times, owners, modes and order, so one commit
// always gives the same bytes. In an unpacked archive (no .git), its SOURCE-MANIFEST.json supplies the
// file list and the commit, so the build and deploy steps work from the archive alone.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const NAME = 'kizashi-ephemeris';
const ARCHIVE = `${NAME}-source.tar.gz`;

function sourceSet() {
  if (existsSync(join(root, '.git'))) {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const dirty = git('status', '--porcelain', '--untracked-files=no');
    if (dirty) throw new Error(`Commit the tracked changes before building the source archive:\n${dirty}`);
    return { files: git('ls-files').split('\n').filter(Boolean), commit: git('rev-parse', 'HEAD'), time: Number(git('log', '-1', '--format=%ct')) };
  }
  // An unpacked archive: rebuild the same set from its manifest.
  const manifest = JSON.parse(readFileSync(join(root, 'SOURCE-MANIFEST.json'), 'utf8'));
  return { files: manifest.files, commit: manifest.commit, time: manifest.time };
}

/** One ustar header (512 bytes) for a regular file or a directory. */
function header(path, size, time, directory) {
  const block = Buffer.alloc(512);
  const field = (offset, length, value) => block.write(value, offset, length, 'utf8');
  const octal = (offset, length, value) => field(offset, length, value.toString(8).padStart(length - 1, '0') + '\0');
  if (Buffer.byteLength(path) > 100) throw new Error(`Path too long for the archive: ${path}`);
  field(0, 100, path);
  octal(100, 8, directory ? 0o755 : 0o644);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, time);
  field(148, 8, '        ');
  field(156, 1, directory ? '5' : '0');
  field(257, 6, 'ustar\0');
  field(263, 2, '00');
  field(265, 32, 'root');
  field(297, 32, 'root');
  let sum = 0;
  for (const byte of block) sum += byte;
  field(148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return block;
}

const { files, commit, time } = sourceSet();
const manifest = Buffer.from(JSON.stringify({ name: NAME, commit, time, files }, null, 2) + '\n');
const entries = [...files.map(file => ({ path: file, data: readFileSync(join(root, file)) })), { path: 'SOURCE-MANIFEST.json', data: manifest }]
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
const directories = [...new Set(entries.flatMap(({ path }) => path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))))].sort();
const blocks = [header(`${NAME}/`, 0, time, true)];
for (const dir of directories) blocks.push(header(`${NAME}/${dir}/`, 0, time, true));
for (const { path, data } of entries) {
  blocks.push(header(`${NAME}/${path}`, data.length, time, false), data, Buffer.alloc((512 - (data.length % 512)) % 512));
}
blocks.push(Buffer.alloc(1024));
// Node writes a zero MTIME into the gzip header, so the compressed bytes depend on the content only.
const archive = gzipSync(Buffer.concat(blocks), { level: 9 });
const out = join(root, 'public', 'source');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, ARCHIVE), archive);
const sha = createHash('sha256').update(archive).digest('hex');
writeFileSync(join(out, `${ARCHIVE}.sha256`), `${sha}  ${ARCHIVE}\n`);
console.log(`${files.length} files, commit ${commit.slice(0, 12)} → public/source/${ARCHIVE} (${sha.slice(0, 12)})`);
