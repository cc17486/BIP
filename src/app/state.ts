/** Single source of truth for the current run. Everything is in memory only. */
import type { AddressType, DerivedKey } from '../lib/derive';
import { fillGaps, freeEntropyBits, randomWords } from '../lib/mnemonic';

export type View = 'airgap' | 'build' | 'results' | 'detail' | 'verify' | 'repair' | 'search';

export interface Hit {
  words: string[];
  index: number;
  address: string;
  path: string;
}

export interface SearchState {
  target: string;
  where: 'prefix' | 'suffix' | 'contains';
  running: boolean;
  tried: number;
  startedAt: number;
  rate: number;
  hits: Hit[];
  varyFiller: boolean;
  depth: number;
  budgetMs: number;
  exhausted: boolean;
  message: string;
}

export interface Candidate {
  ending: string;
  address: string;
  path: string;
  /** Address index used for derivation. */
  index: number;
}

export interface ExportState {
  passphrase: string;
  code: string | null;
  busy: boolean;
  error: string | null;
}

/** Storage can throw on lockdowned browsers or file:// in some engines. */
export const store = {
  get(area: 'session' | 'local', key: string): string | null {
    try {
      return (area === 'session' ? sessionStorage : localStorage).getItem(key);
    } catch {
      return null;
    }
  },
  set(area: 'session' | 'local', key: string, value: string | null): void {
    try {
      const target = area === 'session' ? sessionStorage : localStorage;
      if (value === null) target.removeItem(key);
      else target.setItem(key, value);
    } catch {
      /* storage unavailable: the flag simply does not persist */
    }
  },
};

export const state = {
  view: 'airgap' as View,
  /** Embedded build hash, filled at boot. */
  hash: 'unknown',
  checked: 0,
  selfTest: 'pending' as 'pending' | 'ok' | 'fail',
  asyncFailures: [] as string[],
  rememberDraft: false,
  airgapAck: false,
  /** Slots 0..22 hold the phrase; slot 23 is always the computed checksum word. */
  slots: Array<string | null>(24).fill(null) as (string | null)[],
  /** How many words the user chose deliberately; the rest were drawn at random. */
  fixedLen: 0,
  addressType: 'segwit' as AddressType,
  passphrase: '',
  revealed: true,
  candidates: [] as Candidate[],
  selected: null as number | null,
  derived: null as DerivedKey | null,
  /** Words of the phrase currently shown (including the chosen ending). */
  phrase: [] as string[],
  error: null as string | null,
  exportState: { passphrase: '', code: null, busy: false, error: null } as ExportState,
  search: {
    target: '',
    where: 'prefix',
    running: false,
    tried: 0,
    startedAt: 0,
    rate: 0,
    hits: [],
    varyFiller: false,
    depth: 4000,
    budgetMs: 120_000,
    exhausted: false,
    message: '',
  } as SearchState,
  verify: {
    phrase: '',
    type: 'segwit' as AddressType,
    passphrase: '',
    key: '',
    index: '0',
    expected: '',
    mode: 'phrase' as 'phrase' | 'bip38',
    derivedAddress: '',
    result: null as null | { ok: boolean; detail: string },
  },
};

export const CHIP_MAX = 23;

export function fixedWords(): string[] {
  const out: string[] = [];
  for (let i = 0; i < CHIP_MAX; i++) {
    const w = state.slots[i];
    if (!w) break;
    out.push(w);
  }
  return out;
}

export function fixedCount(): number {
  return fixedWords().length;
}

export function entropyBits(): number {
  return freeEntropyBits(state.fixedLen);
}

/** Fill slots after the fixed phrase with fresh randomness. */
export function fillRest(): void {
  state.slots = fillGaps(state.slots, fixedCount());
}

export function resetSlots(): void {
  state.slots = Array(24).fill(null);
  state.fixedLen = 0;
}

export function pushWord(word: string): boolean {
  const at = fixedCount();
  if (at >= CHIP_MAX) return false;
  state.slots[at] = word;
  state.fixedLen = Math.min(CHIP_MAX, state.fixedLen + 1);
  return true;
}

export function removeWord(index: number): void {
  if (index < 0 || index >= fixedCount()) return;
  state.slots.splice(index, 1);
  state.slots.push(null);
  state.slots = state.slots.slice(0, 24);
  if (index < state.fixedLen) state.fixedLen = Math.max(0, state.fixedLen - 1);
}

export function clearGenerated(): void {
  state.candidates = [];
  state.selected = null;
  state.derived = null;
  state.phrase = [];
  state.error = null;
  state.exportState.code = null;
  state.exportState.error = null;
  state.exportState.busy = false;
}

/** Clear run results but keep the query the user typed. */
export function resetSearchRun(): void {
  state.search.running = false;
  state.search.tried = 0;
  state.search.rate = 0;
  state.search.hits = [];
  state.search.startedAt = 0;
  state.search.exhausted = false;
  state.search.message = '';
}