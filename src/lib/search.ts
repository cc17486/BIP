/**
 * Time-sliced vanity address scanner.
 *
 * Deliberately runs on the main thread: a Vite-inlined worker does not survive
 * a `file://` open and the single-file build is the whole delivery model. Each
 * slice yields to the event loop so taps and scrolling stay responsive.
 *
 * Cost model: deriving the BIP39 seed costs ~5ms and only changes when the
 * phrase changes, so one seed is derived per candidate ending and then scanned
 * across an index window (~0.3ms per address).
 */
import type { HDKey } from '@scure/bip32';

import { accountNode, addressOf, addressPath, seedFor, type AddressType } from './derive';
import { endingCandidates, randomWords } from './mnemonic';

export type Where = 'prefix' | 'suffix' | 'contains';

export interface SearchOptions {
  /** Fixed words, at most 23, in phrase order. */
  prefix: string[];
  type: AddressType;
  passphrase: string;
  target: string;
  where: Where;
  caseSensitive: boolean;
  /** Address index to start from, inclusive. */
  startIndex: number;
  /** Addresses to try per ending word. */
  depth: number;
  /** Regenerate filler words once all endings of a filler set are scanned. */
  varyFiller: boolean;
  /** Wall-clock budget in ms, or Infinity. */
  budgetMs: number;
}

export interface SearchHit {
  words: string[];
  index: number;
  address: string;
  path: string;
}

export interface SearchProgress {
  tried: number;
  rate: number;
  remaining: number;
}

export type DoneReason = 'budget' | 'stopped' | 'full' | 'done';

const SLICE_MS = 45;
const MAX_HITS = 40;

export function matches(
  address: string,
  opts: Pick<SearchOptions, 'target' | 'where' | 'caseSensitive'>,
): boolean {
  if (!opts.target) return true;
  const haystack = opts.caseSensitive ? address : address.toLowerCase();
  const needle = opts.caseSensitive ? opts.target : opts.target.toLowerCase();
  switch (opts.where) {
    case 'prefix':
      return haystack.startsWith(needle);
    case 'suffix':
      return haystack.endsWith(needle);
    default:
      return haystack.includes(needle);
  }
}

interface Ending {
  words: string[];
  account: HDKey;
}

export class Search {
  private readonly opts: SearchOptions;
  private readonly handlers: {
    onHit: (hit: SearchHit) => void;
    onProgress: (p: SearchProgress) => void;
    onDone: (reason: DoneReason) => void;
  };

  private timer: number | null = null;
  private stopped = false;
  private tried = 0;
  private hits = 0;
  private started = 0;
  private windowStart = 0;
  private windowTried = 0;
  private rate = 0;

  private endings: string[] = [];
  private base: string[] = [];
  private endingIndex = 0;
  private ending: Ending | null = null;
  private index = 0;
  private windowEnd = 0;

  constructor(
    opts: SearchOptions,
    handlers: Search['handlers'],
  ) {
    this.opts = opts;
    this.handlers = handlers;
  }

  start(): void {
    this.stopped = false;
    this.started = performance.now();
    this.windowStart = this.started;
    this.index = this.opts.startIndex;
    this.queue();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  get triedCount(): number {
    return this.tried;
  }

  private queue(): void {
    this.timer = window.setTimeout(() => this.slice(), 0);
  }

  private finish(reason: DoneReason): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.report();
    this.handlers.onDone(reason);
  }

  private report(): void {
    const now = performance.now();
    const elapsed = now - this.windowStart;
    if (elapsed > 250) {
      this.rate = Math.round((this.windowTried / elapsed) * 1000);
      this.windowStart = now;
      this.windowTried = 0;
    }
    this.handlers.onProgress({
      tried: this.tried,
      rate: this.rate,
      remaining: this.opts.budgetMs === Infinity ? Infinity : Math.max(0, this.opts.budgetMs - (now - this.started)),
    });
  }

  /** Load the next ending word, deriving its seed once. */
  private advanceEnding(): boolean {
    if (this.base.length === 0 && this.endings.length === 0) {
      // First batch always runs, even when the filler is fixed.
      this.base = [...this.opts.prefix, ...randomWords(23 - this.opts.prefix.length)];
      this.endings = endingCandidates(this.base);
      this.endingIndex = 0;
    }
    while (this.endingIndex >= this.endings.length) {
      if (!this.opts.varyFiller) return false;
      const filler = randomWords(23 - this.opts.prefix.length);
      this.base = [...this.opts.prefix, ...filler];
      this.endings = endingCandidates(this.base);
      this.endingIndex = 0;
    }
    const words = [...this.base, this.endings[this.endingIndex]!];
    this.ending = { words, account: accountNode(seedFor(words, this.opts.passphrase), this.opts.type) };
    this.endingIndex++;
    this.index = this.opts.startIndex;
    this.windowEnd = this.opts.startIndex + this.opts.depth;
    return true;
  }

  private slice(): void {
    if (this.stopped) return;
    const sliceStart = performance.now();

    while (!this.stopped) {
      if (performance.now() - sliceStart > SLICE_MS) break;
      if (performance.now() - this.started > this.opts.budgetMs) {
        this.finish('budget');
        return;
      }

      if (!this.ending) {
        if (!this.advanceEnding()) {
          this.finish('done');
          return;
        }
      }

      const ending = this.ending!;
      const account = ending.account;
      const index = this.index;

      const address = addressOf(account.deriveChild(index), this.opts.type);
      this.tried++;
      this.windowTried++;

      if (matches(address, this.opts)) {
        if (this.endingIndex >= this.endings.length && index + 1 >= this.windowEnd && !this.opts.varyFiller) {
          // Last possible address: emit and stop rather than scheduling more.
          this.handlers.onHit({ words: ending.words, index, address, path: addressPath(this.opts.type, index) });
          this.hits++;
          this.finish('done');
          return;
        }
        this.handlers.onHit({ words: ending.words, index, address, path: addressPath(this.opts.type, index) });
        this.hits++;
        this.report();
        if (this.hits >= MAX_HITS) {
          this.finish('full');
          return;
        }
      }

      this.index++;
      if (this.index >= this.windowEnd) this.ending = null;
    }

    this.report();
    if (!this.stopped) this.queue();
  }
}

/** Rough expected attempts for a target, for the difficulty line. */
export function expectedAttempts(target: string, alphabetSize: number, where: Where): number {
  const len = target.length;
  if (len === 0) return 1;
  const base = alphabetSize ** len;
  return where === 'contains' ? Math.max(1, base / 4) : base;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}