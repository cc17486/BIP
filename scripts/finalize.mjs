#!/usr/bin/env node
/**
 * Post-build: rename the bundle, stamp the build hash, and write the manifest.
 *
 * The hash is computed over the file with the 64-character hash region zeroed,
 * then written into that region. `scripts/check-hash.mjs` repeats the same
 * zeroing, so the published hash stays verifiable after the stamp.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';
const RAW = join(DIST, 'index.html');
const FINAL = join(DIST, 'vanity-phrase.html');
const PLACEHOLDER = '0'.repeat(64);
const ATTR = /data-apphash="([0-9a-f]{64})"/;

async function main() {
  const html = await readFile(RAW, 'utf8');
  if (!ATTR.test(html)) throw new Error('hash placeholder missing from the built page');
  if (!html.includes(PLACEHOLDER)) throw new Error('hash placeholder is not zeroed');

  const hash = createHash('sha256').update(html).digest('hex');
  const stamped = html.replace(ATTR, `data-apphash="${hash}"`);
  await writeFile(FINAL, stamped);
  await unlink(RAW);

  for (const name of await readdir(DIST)) {
    if (name !== 'vanity-phrase.html') await unlink(join(DIST, name)).catch(() => {});
  }

  const size = (await stat(FINAL)).size;
  await writeFile(`${FINAL}.sha256`, `${hash}  vanity-phrase.html\n`);
  await writeFile(
    join(DIST, 'BUILD-INFO.txt'),
    [
      'BIP39 vanity phrase generator — airgapped single-file build',
      '',
      `sha256 (hash region zeroed): ${hash}`,
      `bytes: ${size}`,
      `built: ${new Date().toISOString()}`,
      '',
      'Verify before trusting:',
      '  node scripts/check-hash.mjs dist/vanity-phrase.html',
      '',
      'Deploy: copy vanity-phrase.html to the phone and open it from local storage.',
      'The page issues no network requests; the CSP has connect-src none.',
      '',
    ].join('\n'),
  );

  console.log(`finalised ${FINAL}`);
  console.log(`sha256 ${hash}`);
  console.log(`size ${size} bytes`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});