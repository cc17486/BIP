#!/usr/bin/env node
/** Render a chapter frame from the explainer to a PNG file.
 *  Headless Chromium will not composite WebGL here, so the page hands back a
 *  data URL of the framebuffer and we decode it. */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const act = process.argv[2] ?? '1';
const out = resolve(process.argv[3] ?? `shots/explainer-${act}.png`);
const file = resolve('dist/explainer.html');
const profile = await mkdtemp(join(tmpdir(), 'still-'));

const dom = await new Promise((done, fail) => {
  const child = spawn('/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${profile}`, '--virtual-time-budget=9000', '--dump-dom',
    `file://${file}?still=${act}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  child.stdout.on('data', (c) => { buf += c; });
  child.stderr.resume();
  child.on('error', fail);
  child.on('close', () => done(buf));
}).finally(() => rm(profile, { recursive: true, force: true }));

const match = /data-frame="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(dom);
if (!match) {
  console.error('no frame in the page; did the still branch run?');
  process.exit(1);
}
await writeFile(out, Buffer.from(match[1], 'base64'));
console.log(`wrote ${out} (${Buffer.from(match[1], 'base64').length} bytes)`);
