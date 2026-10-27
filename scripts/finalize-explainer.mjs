#!/usr/bin/env node
/** Stamp the explainer build hash and move it next to the generator. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, unlink, stat, rename } from 'node:fs/promises';
import { join } from 'node:path';

const RAW = 'dist-explainer/index.html';
const FINAL = 'dist/explainer.html';
const ATTR = /data-apphash="([0-9a-f]{64})"/;
const PLACEHOLDER = '0'.repeat(64);

const html = await readFile(RAW, 'utf8');
if (!ATTR.test(html)) throw new Error('hash placeholder missing from the explainer build');

const hash = createHash('sha256').update(html).digest('hex');
if (!html.includes(PLACEHOLDER)) throw new Error('hash placeholder is not zeroed');

await writeFile(FINAL, html.replace(ATTR, `data-apphash="${hash}"`));
for (const name of await readdir('dist-explainer')) {
  if (name !== 'index.html') await unlink(join('dist-explainer', name)).catch(() => {});
}
await rename('dist-explainer/index.html', RAW);
await writeFile(`${FINAL}.sha256`, `${hash}  explainer.html\n`);

const size = (await stat(FINAL)).size;
console.log(`finalised ${FINAL}`);
console.log(`sha256 ${hash}`);
console.log(`size ${size} bytes`);