#!/usr/bin/env node
/**
 * Headless check of the explainer: WebGL up, animation progressing, no network,
 * no page errors, captions actually changing.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FILE = resolve(process.argv[2] ?? 'dist/explainer.html');
const CHROME = process.env.CHROME ?? '/usr/bin/chromium';
const profile = await mkdtemp(join(tmpdir(), 'explain-e2e-'));

const dom = await new Promise((resolveRun, reject) => {
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--disable-background-networking',
      `--user-data-dir=${profile}`,
      '--window-size=390,844',
      '--virtual-time-budget=40000',
      '--dump-dom',
      `file://${FILE}?e2e`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let out = '';
  child.stdout.on('data', (chunk) => {
    out += chunk;
    if (out.length > 40_000_000) child.kill();
  });
  child.stderr.resume();
  child.on('error', reject);
  child.on('close', () => resolveRun(out));
}).finally(() => rm(profile, { recursive: true, force: true }));

const title = /<title>([\s\S]*?)<\/title>/.exec(dom)?.[1] ?? '';
if (!title.startsWith('EXPLAIN:')) {
  console.error('no explainer report in the title');
  console.error(dom.slice(0, 1500));
  process.exit(1);
}

const report = JSON.parse(title.slice(8));
const problems = [];
if (report.webgl !== true) problems.push('WebGL unavailable');
if (report.frames < 1) problems.push('renderer never drew a frame');
if (report.act < 4) problems.push(`stalled at chapter ${report.act}`);
if (report.rendered !== true || report.triangles < 1) problems.push('nothing was drawn');
if ((report.errors ?? []).length > 0) problems.push(`page errors: ${report.errors.join(' | ')}`);
if (report.resources !== 0) problems.push(`${report.resources} resource request(s)`);
if (!dom.includes('<canvas')) problems.push('no canvas in the DOM');

const captions = /<h1 id="caption-title">([^<]*)</.exec(dom)?.[1] ?? '';
if (!captions || captions === 'Loading…') problems.push('captions never advanced');

const html = await readFile(FILE, 'utf8');
if (!html.includes('data-apphash')) problems.push('no hash stamp');

for (const [name, value] of Object.entries(report)) console.log(`${String(value).padEnd(8)} ${name}`);
console.log(`caption  ${captions}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log('\nexplainer e2e passed');