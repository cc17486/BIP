#!/usr/bin/env node
/**
 * Headless end-to-end run against the built file over file:// with no server.
 * Fails unless every assertion in src/e2e.ts holds, the page made zero resource
 * requests, and the layout survives both a narrow and a regular phone width.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FILE = resolve(process.argv[2] ?? 'dist/vanity-phrase.html');
const CHROME = process.env.CHROME ?? '/usr/bin/chromium';
const WIDTHS = [390, 320];
const REQUIRED = [
  'done',
  'unique',
  'allValid',
  'prefixes',
  'pathOk',
  'bip38',
  'roundTrip',
  'hashOk',
  'matchPrefix',
  'matchSuffix',
  'matchContains',
  'inputFontOk',
  'suggestShown',
  'chipAdded',
  'eightResults',
  'detailQr',
  'sealed',
  'verified',
  'taprootVerified',
  'searchHit',
  'searchPicked',
  'typeSwitch',
  'wifVerified',
  'maxWords',
  'overLimitGuard',
  'entropyAtMax',
  'rapidGenerate',
  'maskWorks',
  'longPassphrase',
  'stopOnLeave',
  'airgapGate',
  'repairWorks',
  'staleNote',
  'repairLimit',
  'clipboardFallback',
];

const profile = await mkdtemp(join(tmpdir(), 'vanity-e2e-'));

function run(width) {
  return new Promise((resolveRun, reject) => {
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
        `--window-size=${width},844`,
        '--virtual-time-budget=25000',
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
  });
}

const problems = [];

try {
  for (const width of WIDTHS) {
    const dom = await run(width);
    const title = /<title>([\s\S]*?)<\/title>/.exec(dom)?.[1] ?? '';
    if (!title.startsWith('E2E:')) {
      problems.push(`${width}px: no E2E report in the title`);
      const body = /<pre id="e2e-report">([\s\S]*?)<\/pre>/.exec(dom)?.[1];
      problems.push(body ?? dom.slice(0, 1200));
      continue;
    }

    const report = JSON.parse(title.slice(4));
    const failed = [];
    if (report.error) failed.push(`page error: ${report.error}`);
    if (report.selftest !== 'ok') failed.push(`self-test ${report.selftest}`);
    if (report.resources !== 0) failed.push(`${report.resources} resource request(s)`);
    if (report.endings !== 8) failed.push(`expected 8 endings, got ${report.endings}`);
    if (report.overflowX) failed.push('horizontal overflow');
    if (report.smallTaps > 0) failed.push(`${report.smallTaps} control(s) under 40px`);
    for (const key of REQUIRED) if (report[key] !== true) failed.push(`${key} failed`);
    problems.push(...failed.map((f) => `${width}px: ${f}`));
    if (failed.length) console.log('debug:', JSON.stringify(report));
    console.log(`${width}px  ${failed.length === 0 ? 'ok' : 'FAIL'}  (${report.endings} endings, ${report.resources} requests)`);
  }
} finally {
  await rm(profile, { recursive: true, force: true });
}

const html = await readFile(FILE, 'utf8');
if (!html.includes('data-apphash')) problems.push('no stamp in file');

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log('offline e2e passed');