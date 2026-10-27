#!/usr/bin/env node
/**
 * Airgap audit of the built file: the things a reviewer would otherwise have
 * to check by hand before trusting it on an airgapped phone.
 */
import { readFile, stat } from 'node:fs/promises';

const FILE = process.argv[2] ?? 'dist/vanity-phrase.html';
const MAX_BYTES = Number(process.env.MAX_BYTES ?? 500_000);
// Inert references: SVG namespace and a citation inside three.js source comments.
const ALLOWED_HOSTS = new Set(['www.w3.org', 'jcgt.org']);

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

const html = await readFile(FILE, 'utf8');
const size = (await stat(FILE)).size;

// 1. No remote asset references of any kind.
const attrs = [...html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
for (const url of attrs) {
  if (url.startsWith('data:')) continue;
  if (url.startsWith('#')) continue;
  if (/^https?:\/\//.test(url)) {
    const host = new URL(url).host;
    if (!ALLOWED_HOSTS.has(host)) fail(`remote reference: ${url}`);
    else warnings.push(`remote-looking reference kept: ${url}`);
  } else if (!url.startsWith('/')) {
    warnings.push(`relative reference (should have been inlined): ${url}`);
  }
}

// 1b. Attributes that can pull a resource and are easy to overlook.
for (const pattern of [
  /\bsrcset\s*=\s*"([^"]*)"/g,
  /\bposter\s*=\s*"([^"]*)"/g,
  /\bformaction\s*=\s*"([^"]*)"/g,
  /\bdata\s*=\s*"(https?:[^"]*)"/g,
]) {
  for (const match of html.matchAll(pattern)) {
    if (/https?:|\/\//.test(match[1])) fail(`remote attribute reference: ${match[0]}`);
  }
}

// 1c. CSS can fetch too: url() and @import.
for (const match of html.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
  const value = match[1].trim();
  // `${...}` is a runtime template in the inlined JS, not a static fetch.
  if (value.startsWith('data:') || value.startsWith('#') || value.startsWith('${')) continue;
  fail(`CSS url() reference: ${value}`);
}
if (/@import\s+(?:url\()?['"]?(?!data:)/.test(html)) fail('CSS @import');

// 2. Any bare http(s) URL in the code is a candidate for a fetch.
for (const match of html.matchAll(/https?:\/\/[a-zA-Z0-9./_%\-]+/g)) {
  const host = new URL(match[0]).host;
  if (!ALLOWED_HOSTS.has(host)) fail(`URL in code: ${match[0]}`);
}

// 3. Content-Security-Policy must exist and forbid connections.
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
if (!csp) fail('no Content-Security-Policy meta tag');
else {
  const policy = csp[1];
  if (!/connect-src 'none'/.test(policy)) fail("CSP does not set connect-src 'none'");
  for (const directive of ['default-src', 'script-src', 'img-src', 'base-uri', 'form-action']) {
    if (!policy.includes(directive)) fail(`CSP missing ${directive}`);
  }
  if (!/worker-src blob: data:/.test(policy)) warnings.push('CSP has no worker-src (fine: the build uses no workers)');
}

// 4. No worker usage, since inlined workers do not survive file://.
if (/\bnew Worker\(/.test(html)) warnings.push('page constructs a Worker');

// 5. No dynamic remote imports.
if (/import\(\s*["']https?:/.test(html)) fail('dynamic remote import');

// 6. Size budget and single-file shape.
if (size > MAX_BYTES) fail(`size ${size} exceeds ${MAX_BYTES} (raise MAX_BYTES for large pages)`);
if (!/^<!doctype html>/i.test(html)) fail('not a standalone HTML document');
if (/<base\b/i.test(html)) fail('<base> is present, which can redirect relative URLs');
if (/<iframe\b/i.test(html)) fail('<iframe> is present');
if (/<form\b/i.test(html)) fail('<form> is present (would need form-action)');
const scriptTags = [...html.matchAll(/<script\b[^>]*>/g)].length;
if (scriptTags !== 1) fail(`expected exactly 1 inline script, found ${scriptTags}`);
if (/<script[^>]+src="(?!data:)/.test(html)) fail('script with a non-data src');

// 7. The hash region must be stamped (not the build-time placeholder).
if (!/data-apphash="(?!0{64})[0-9a-f]{64}"/.test(html)) fail('build hash not stamped');

// 8. Self-test and safety strings present.
for (const needle of ['connect-src', 'BIP38', 'scrypt']) {
  if (!html.toLowerCase().includes(needle.toLowerCase())) warnings.push(`expected text missing: ${needle}`);
}

for (const w of warnings) console.log(`warn  ${w}`);
for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`${size} bytes, ${scriptTags} script tag(s)`);

if (failures.length > 0) {
  console.log(`\n${failures.length} problem(s)`);
  process.exit(1);
}
console.log('airgap audit passed');