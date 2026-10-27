#!/usr/bin/env node
/**
 * Verify the build hash of a delivered file.
 * The hash region itself is zeroed before hashing, because it cannot contain
 * its own digest. Usage: node scripts/check-hash.mjs <file>
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const ATTR = /data-apphash="([0-9a-f]{64})"/;

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-hash.mjs <file>');
  process.exit(2);
}

const html = await readFile(file, 'utf8');
const found = ATTR.exec(html);
if (!found) {
  console.error('FAIL: no data-apphash region found');
  process.exit(1);
}

const claimed = found[1];
const zeroed = html.replace(ATTR, `data-apphash="${'0'.repeat(64)}"`);
const actual = createHash('sha256').update(zeroed).digest('hex');

if (actual !== claimed) {
  console.error(`FAIL: hash mismatch\n  embedded ${claimed}\n  actual   ${actual}`);
  process.exit(1);
}

console.log(`ok ${actual}`);
console.log(`bytes ${Buffer.byteLength(html)}`);