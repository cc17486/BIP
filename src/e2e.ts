/**
 * Self-driving harness, activated with `?e2e` on the URL.
 * Results are published in the document title so a headless run can read them
 * without any automation dependency.
 */
import { chooseCandidate, generateCandidates } from './app/flow';
import { go } from './app/router';
import { state } from './app/state';
import { addressHash, decodeBip38, decryptBip38, encryptBip38, hashesEqual } from './lib/bip38';
import { addressFromPrivateKey } from './lib/derive';
import { isValidPhrase } from './lib/mnemonic';
import { matches } from './lib/search';
import { WIF } from '@scure/btc-signer/payment.js';
import { NETWORK } from '@scure/btc-signer/utils.js';

interface Report {
  resources: number;
  selftest: string;
  endings: number;
  unique: boolean;
  allValid: boolean;
  prefixes: boolean;
  pathOk: boolean;
  bip38: boolean;
  roundTrip: boolean;
  hashOk: boolean;
  matchPrefix: boolean;
  matchSuffix: boolean;
  matchContains: boolean;
  done: boolean;
  overflowX: boolean;
  smallTaps: number;
  inputFontOk: boolean;
  suggestShown: boolean;
  chipAdded: boolean;
  eightResults: boolean;
  detailQr: boolean;
  sealed: boolean;
  verified: boolean;
  taprootVerified: boolean;
  searchHit: boolean;
  searchDebug: string;
  searchPicked: boolean;
  typeSwitch: boolean;
  wifVerified: boolean;
  maxWords: boolean;
  overLimitGuard: boolean;
  entropyAtMax: boolean;
  rapidGenerate: boolean;
  maskWorks: boolean;
  longPassphrase: boolean;
  stopOnLeave: boolean;
  airgapGate: boolean;
  repairWorks: boolean;
  staleNote: boolean;
  repairLimit: boolean;
  repairChecksumHint: boolean;
  clipboardFallback: boolean;
  repairDebug: string;
  error?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function waitFor(predicate: () => boolean, timeout = 20_000): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const poll = (): void => {
      if (predicate()) return resolve(true);
      if (Date.now() - started > timeout) return resolve(false);
      window.setTimeout(poll, 60);
    };
    poll();
  });
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function byText(selector: string, text: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(selector)].find((n) => (n.textContent ?? '').includes(text)) ?? null;
}

/** Drive the real DOM the way a thumb would. */
async function uiFlow(report: Report): Promise<void> {
  // The gate renders first on a cold profile.
  if (byText('button', 'airgapped')) {
    byText('button', 'airgapped')!.click();
    await sleep(120);
    report.airgapGate = document.querySelector('.bar h1')?.textContent === 'Build your phrase';
  }

  state.slots = Array(24).fill(null);
  state.fixedLen = 0;
  state.addressType = 'segwit';
  state.passphrase = '';
  state.view = 'build';
  go('build');
  await sleep(80);

  const input = document.querySelector<HTMLInputElement>('input[aria-label="Add a word from the BIP39 list"]')!;
  type(input, 'zeb');
  await sleep(60);
  const suggestion = document.querySelector<HTMLButtonElement>('.suggest button');
  report.suggestShown = suggestion !== null;
  if (!suggestion) return;
  suggestion.click();
  await sleep(80);
  report.chipAdded = document.querySelectorAll('.chip').length === 1;

  byText('button', 'random')?.click();
  await sleep(60);

  // Address-type buttons must not be swallowed by their wrapping label.
  byText('button', 'Legacy')!.click();
  await sleep(60);
  report.typeSwitch = (state.addressType as string) === 'legacy';
  byText('button', 'Native SegWit')!.click();
  await sleep(60);
  report.typeSwitch = report.typeSwitch && (state.addressType as string) === 'segwit';

  const generate = document.querySelector<HTMLButtonElement>('.bottombar button.primary')!;
  generate.click();
  await sleep(300);
  report.eightResults = document.querySelectorAll('.opt').length === 8;
  if (!report.eightResults) return;

  document.querySelector<HTMLButtonElement>('.opt')!.click();
  await sleep(160);
  report.detailQr = document.querySelectorAll('.qr svg').length >= 2 && document.querySelectorAll('.phrase .w').length === 24;
  if (!report.detailQr) return;

  const pass = document.querySelector<HTMLInputElement>('input[placeholder^="BIP38 passphrase"]')!;
  type(pass, 'ui-passphrase');
  await sleep(40);
  byText('button', 'Seal')!.click();
  report.sealed = await waitFor(() => (document.body.textContent ?? '').includes('6P'));
  if (!report.sealed) return;

  byText('button', 'Verify this key')!.click();
  await sleep(120);
  byText('button', 'Run the check')!.click();
  report.verified = await waitFor(() => document.querySelector('.banner.ok') !== null);

  // Same leg for taproot: the sealed key is the tweaked output key there.
  state.addressType = 'taproot';
  state.slots = Array(24).fill(null);
  state.fixedLen = 2;
  state.view = 'build';
  go('build');
  await sleep(80);
  document.querySelector<HTMLButtonElement>('.bottombar button.primary')!.click();
  await sleep(320);
  document.querySelector<HTMLButtonElement>('.opt')!.click();
  await sleep(160);
  const pass2 = document.querySelector<HTMLInputElement>('input[placeholder^="BIP38 passphrase"]')!;
  type(pass2, 'ui-taproot-pass');
  await sleep(40);
  byText('button', 'Seal')!.click();
  if (await waitFor(() => document.body.textContent!.includes('6P'))) {
    byText('button', 'Verify this key')!.click();
    await sleep(120);
    byText('button', 'Run the check')!.click();
    report.taprootVerified = await waitFor(() => document.querySelector('.banner.ok') !== null);
  }

  // Key mode + WIF branch of the verifier.
  go('verify');
  await sleep(80);
  byText('button', 'Key')!.click();
  await sleep(60);
  const keyBox = document.querySelector<HTMLInputElement>('input[placeholder^="6P"]')!;
  type(keyBox, state.derived!.wif);
  await sleep(40);
  byText('button', 'Run the check')!.click();
  report.wifVerified = await waitFor(() => document.querySelector('.banner.ok') !== null, 5000);

  // Search one character on a suffix: should hit almost at once.
  state.addressType = 'segwit';
  go('search');
  await sleep(80);
  const target = document.querySelector<HTMLInputElement>('input[placeholder^="abc123"]') ?? document.querySelector<HTMLInputElement>('main input')!;
  type(target, 'z');
  await sleep(40);
  byText('button', 'Ends with')!.click();
  byText('button', 'Start searching')!.click();
  report.searchHit = await waitFor(() => document.querySelector('.hit') !== null, 15_000);
  report.searchDebug = `${state.search.target}|${state.search.where}|${state.search.running}|${state.search.tried}|${state.search.hits.length}|${state.search.message}`;
  document.querySelector<HTMLButtonElement>('.hit button')?.click();
  await sleep(140);
  report.searchPicked = document.querySelectorAll('.phrase .w').length === 24 && !!document.querySelector('.qr svg');
  byText('button', 'Stop')?.click();
}

const POOL = ['zebra', 'kite', 'art', 'ocean', 'bonus', 'canvas', 'gadget', 'letter', 'guitar', 'ice', 'flag', 'valve', 'pen', 'glad', 'lunar', 'moon'];

function wordInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[aria-label="Add a word from the BIP39 list"]')!;
}

function enter(input: HTMLInputElement): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

async function stressFlow(report: Report): Promise<void> {
  // Fill the phrase to the 23-word limit through the real input.
  state.slots = Array(24).fill(null);
  state.fixedLen = 0;
  state.addressType = 'segwit';
  go('build');
  await sleep(80);
  for (let i = 0; i < 23; i++) {
    const input = wordInput();
    type(input, POOL[i % POOL.length]!);
    enter(input);
    await sleep(12);
  }
  await sleep(60);
  report.maxWords = document.querySelectorAll('.chip').length === 23;
  report.entropyAtMax = (document.body.textContent ?? '').includes('3 bits');

  const over = wordInput();
  type(over, 'zebra');
  enter(over);
  await sleep(80);
  report.overLimitGuard = (document.body.textContent ?? '').includes('already 23 words');

  // Three generate taps in a row must still land on eight results.
  const generate = document.querySelector<HTMLButtonElement>('.bottombar button.primary')!;
  generate.click();
  generate.click();
  generate.click();
  await sleep(500);
  report.rapidGenerate = document.querySelectorAll('.opt').length === 8;

  document.querySelector<HTMLButtonElement>('.opt')!.click();
  await sleep(140);

  // Mask toggle must hide every word on the key screen.
  document.querySelector<HTMLButtonElement>('.bar button[aria-label="Hide words"]')!.click();
  await sleep(100);
  report.maskWorks = document.querySelectorAll('.phrase .w.hide').length === 24;

  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  const copy = byText('button', 'Copy');
  if (copy) {
    copy.click();
    await sleep(120);
    report.clipboardFallback = /Copied|Select manually/.test(copy.textContent ?? '');
  }


  // A long, non-ASCII passphrase has to survive the whole seal/verify trip.
  const pass = document.querySelector<HTMLInputElement>('input[placeholder^="BIP38 passphrase"]')!;
  type(pass, '💩-'.repeat(60));
  await sleep(40);
  byText('button', 'Seal')!.click();
  if (await waitFor(() => document.body.textContent!.includes('6P'), 25_000)) {
    byText('button', 'Verify this key')!.click();
    await sleep(140);
    byText('button', 'Run the check')!.click();
    report.longPassphrase = await waitFor(() => document.querySelector('.banner.ok') !== null, 25_000);
  }

  // Repair: five words in, eight endings out, and a stale marker after an edit.
  go('repair');
  await sleep(80);
  const box = document.querySelector<HTMLTextAreaElement>('textarea')!;
  type(box, 'zebra kite art ocean bonus');
  await sleep(40);
  byText('button', 'Check and complete')!.click();
  await sleep(200);
  report.repairDebug = `opts:${document.querySelectorAll('.opt').length} err:${document.querySelector('.banner.danger')?.textContent ?? '-'}`;
  report.repairWorks = document.querySelectorAll('.opt').length === 8;
  const box2 = document.querySelector<HTMLTextAreaElement>('textarea')!;
  type(box2, 'zebra kite art ocean bonus canvas');
  await sleep(60);
  report.staleNote = document.getElementById('stale-note')?.hidden === false;
  try {
    document.querySelector<HTMLButtonElement>('.opt')!.click();
  } catch (err) {
    report.repairDebug += ` threw:${err instanceof Error ? err.message : String(err)}`;
  }
  await sleep(160);
  report.repairDebug += ` after:${document.querySelectorAll('.phrase .w').length} view:${state.view} phrase:${state.phrase.length} txt:${document.querySelector('.opt')?.textContent?.slice(0, 12)}`;
  report.repairWorks = report.repairWorks && document.querySelectorAll('.phrase .w').length === 24;

  // 24 real words with a wrong checksum: explain and drop the last word.
  go('repair');
  await sleep(80);
  const badBox = document.querySelector<HTMLTextAreaElement>('textarea')!;
  type(badBox, `${POOL.slice(0, 23).join(' ')} abandon`);
  await sleep(40);
  byText('button', 'Check and complete')!.click();
  await sleep(120);
  report.repairChecksumHint =
    (document.body.textContent ?? '').includes('checksum fails') &&
    (document.querySelector('textarea')?.value ?? '').split(' ').length === 23;

  // Too many words and a clipboard-less copy.
  go('repair');
  await sleep(80);
  const longBox = document.querySelector<HTMLTextAreaElement>('textarea')!;
  type(longBox, Array.from({ length: 30 }, (_, i) => POOL[i % POOL.length]).join(' '));
  await sleep(40);
  byText('button', 'Check and complete')!.click();
  await sleep(120);
  report.repairLimit = (document.body.textContent ?? '').includes('at most 23 words');


  // Leaving the search screen must stop the run.
  go('search');
  await sleep(80);
  const target = document.querySelector<HTMLInputElement>('main input')!;
  type(target, 'zz');
  await sleep(40);
  byText('button', 'Start searching')!.click();
  await sleep(120);
  go('build');
  await sleep(120);
  report.stopOnLeave = state.search.running === false;
}

export async function runE2E(): Promise<void> {
  const report: Report = {
    resources: performance.getEntriesByType('resource').length,
    selftest: state.selfTest,
    endings: 0,
    unique: false,
    allValid: false,
    prefixes: false,
    pathOk: false,
    bip38: false,
    roundTrip: false,
    hashOk: false,
    matchPrefix: false,
    matchSuffix: false,
    matchContains: false,
    done: false,
    overflowX: false,
    smallTaps: 0,
    inputFontOk: true,
    suggestShown: false,
    chipAdded: false,
    eightResults: false,
    detailQr: false,
    sealed: false,
    verified: false,
    taprootVerified: false,
    searchHit: false,
    searchDebug: '',
    searchPicked: false,
    typeSwitch: false,
    wifVerified: false,
    maxWords: false,
    overLimitGuard: false,
    entropyAtMax: false,
    rapidGenerate: false,
    maskWorks: false,
    longPassphrase: false,
    stopOnLeave: false,
    airgapGate: false,
    repairWorks: false,
    staleNote: false,
    repairLimit: false,
    repairChecksumHint: false,
    clipboardFallback: false,
    repairDebug: '',
  };

  try {
    state.view = 'build';
    state.slots = Array(24).fill(null);
    state.slots[0] = 'zebra';
    state.slots[1] = 'kite';
    state.fixedLen = 2;
    state.addressType = 'segwit';

    const candidates = generateCandidates();
    report.endings = candidates.length;
    report.unique = new Set(candidates.map((c) => c.address)).size === 8;
    const prefix = state.slots.slice(0, 23) as string[];
    report.allValid = candidates.every((c) => isValidPhrase([...prefix, c.ending]));
    report.prefixes = candidates.every((c) => c.address.startsWith('bc1q'));
    report.pathOk = candidates.every((c) => c.path === "m/84'/0'/0'/0/0");

    chooseCandidate(0);
    const derived = state.derived!;
    report.matchPrefix = matches(derived.address, { target: derived.address.slice(0, 6), where: 'prefix', caseSensitive: false });
    report.matchSuffix = matches(derived.address, { target: derived.address.slice(-6), where: 'suffix', caseSensitive: false });
    report.matchContains = matches(derived.address, { target: derived.address.slice(8, 14), where: 'contains', caseSensitive: false });

    const code = await encryptBip38(WIF(NETWORK).decode(derived.wif), derived.address, 'e2e-passphrase');
    report.bip38 = decodeBip38(code).compressed && code.startsWith('6P');
    const plain = await decryptBip38(code, 'e2e-passphrase');
    report.roundTrip = hashesEqual(addressHash(addressFromPrivateKey(plain.privateKey, 'segwit')), plain.addressHash);
    report.hashOk = /^[0-9a-f]{64}$/.test(state.hash) && state.hash !== 'unverified';

    // Layout probe: run this with a phone-sized window.
    await sleep(60);
    report.overflowX = document.documentElement.scrollWidth > window.innerWidth + 1;
    const taps = [...document.querySelectorAll('button, input:not([type=checkbox]), textarea')].filter((node) => {
      if (node.classList.contains('rm') || node.classList.contains('suggestbtn')) return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    report.smallTaps = taps.filter((node) => node.getBoundingClientRect().height < 40).length;
    report.inputFontOk = [...document.querySelectorAll('input:not([type=checkbox]), textarea')].every(
      (node) => Number.parseFloat(getComputedStyle(node).fontSize) >= 16,
    );
    await uiFlow(report);
    await stressFlow(report);
    await sleep(50);
  } catch (err) {
    report.error = err instanceof Error ? `${err.message}` : String(err);
  }

  report.done = true;
  document.title = `E2E:${JSON.stringify(report)}`;
  const node = document.createElement('pre');
  node.id = 'e2e-report';
  node.textContent = JSON.stringify(report, null, 1);
  document.body.append(node);
}