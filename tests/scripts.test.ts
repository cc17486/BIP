import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const BUILT = 'dist/vanity-phrase.html';

function run(script: string, args: string[]): { status: number | null; out: string } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

async function scratch(name: string, mutate: (html: string) => string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'audit-'));
  const html = await readFile(BUILT, 'utf8');
  const target = join(dir, name);
  await writeFile(target, mutate(html));
  return target;
}

const hasBuild = await readFile(BUILT, 'utf8').then(
  () => true,
  () => false,
);

describe.skipIf(!hasBuild)('hash check script', () => {
  it('accepts the shipped file', () => {
    const { status, out } = run('scripts/check-hash.mjs', [BUILT]);
    expect(status).toBe(0);
    expect(out).toContain('ok');
  });

  it('detects a single flipped character', async () => {
    const file = await scratch('tampered.html', (html) => {
      const at = html.indexOf('Airgap check');
      return html.slice(0, at) + 'Airgap cheque' + html.slice(at + 12);
    });
    const { status, out } = run('scripts/check-hash.mjs', [file]);
    expect(status).toBe(1);
    expect(out).toContain('mismatch');
  });

  it('refuses a file with no hash region', async () => {
    const file = await scratch('stripped.html', (html) => html.replace(/data-apphash="[0-9a-f]{64}"/, ''));
    const { status } = run('scripts/check-hash.mjs', [file]);
    expect(status).toBe(1);
  });
});

describe.skipIf(!hasBuild)('airgap audit script', () => {
  const cases: { name: string; mutate: (html: string) => string; expect: string }[] = [
    { name: 'remote image', mutate: (h) => h.replace('</head>', '<link rel="stylesheet" href="https://cdn.example/x.css"></head>'), expect: 'remote reference' },
    { name: 'srcset', mutate: (h) => h.replace('</body>', '<img srcset="https://cdn.example/x.png 2x"></body>'), expect: 'remote attribute' },
    { name: 'css url', mutate: (h) => h.replace('</head>', '<style>body{background:url(https://x.example/a.png)}</style></head>'), expect: 'CSS url()' },
    { name: 'iframe', mutate: (h) => h.replace('</body>', '<iframe src="about:blank"></iframe></body>'), expect: 'iframe' },
    { name: 'form', mutate: (h) => h.replace('</body>', '<form></form></body>'), expect: 'form' },
    { name: 'base', mutate: (h) => h.replace('</head>', '<base href="https://x.example/"></head>'), expect: 'base' },
    { name: 'script src', mutate: (h) => h.replace('</body>', '<script src="app.js"></script></body>'), expect: 'script' },
    { name: 'unstamped hash', mutate: (h) => h.replace(/data-apphash="[0-9a-f]{64}"/, `data-apphash="${'0'.repeat(64)}"`), expect: 'hash not stamped' },
    { name: 'weakened CSP', mutate: (h) => h.replace("connect-src 'none'", "connect-src *"), expect: 'connect-src' },
    { name: 'second script tag', mutate: (h) => h.replace('</body>', '<script>1</script></body>'), expect: 'exactly 1 inline script' },
  ];

  for (const testCase of cases) {
    it(`rejects ${testCase.name}`, async () => {
      const file = await scratch('case.html', testCase.mutate);
      const { status, out } = run('scripts/verify-build.mjs', [file]);
      expect(status).toBe(1);
      expect(out.toLowerCase()).toContain(testCase.expect.toLowerCase());
    });
  }

  it('accepts the shipped file', () => {
    const { status } = run('scripts/verify-build.mjs', [BUILT]);
    expect(status).toBe(0);
  });
});