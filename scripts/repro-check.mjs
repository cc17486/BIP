#!/usr/bin/env node
/** Two clean builds must produce the same bytes, or the hash proves nothing. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const FILE = process.argv[2] ?? 'dist/vanity-phrase.html';
const ATTR = /data-apphash="[0-9a-f]{64}"/;

/** Same zeroed-region hash the published stamp uses. */
const hash = async () => {
  const html = await readFile(FILE, 'utf8');
  const zeroed = html.replace(ATTR, `data-apphash="${'0'.repeat(64)}"`);
  return createHash('sha256').update(zeroed).digest('hex');
};

const build = () => {
  const result = spawnSync('npm', ['run', 'build'], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    process.exit(1);
  }
};

build();
const first = await hash();
build();
const second = await hash();

if (first !== second) {
  console.error(`not reproducible\n  ${first}\n  ${second}`);
  process.exit(1);
}
console.log(`reproducible ${first}`);
