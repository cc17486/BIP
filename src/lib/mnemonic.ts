/**
 * BIP39 24-word mechanics.
 *
 * A 24-word phrase carries 256 bits of entropy plus an 8-bit checksum, packed
 * 11 bits per word. Word 24 therefore holds the final 3 entropy bits in its
 * top bits and the checksum in its low 8 bits, so for any fixed first 23 words
 * there are exactly 8 valid finishing words: one per value of those 3 bits.
 *
 * This module only ever *searches* those 8; it never guesses a checksum.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { validateMnemonic } from '@scure/bip39';
import { randomBytes } from '@noble/hashes/utils.js';

import { WORDS, wordAt, wordIndex } from './words.js';

export const WORD_TOTAL = 24;
export const FIXED_MAX = 23;
export const CHECKSUM_INDEX = 23;
const CHECKSUM_BITS = 8;
const BITS_PER_WORD = 11;
const FREE_BITS = 3;
const ENTROPY_BYTES = 32;

/** Bits of real entropy left when `fixedCount` of the first 23 words are chosen. */
export function freeEntropyBits(fixedCount: number): number {
  const clamped = Math.max(0, Math.min(FIXED_MAX, fixedCount));
  return BITS_PER_WORD * (FIXED_MAX - clamped) + FREE_BITS;
}

class BitWriter {
  readonly bytes = new Uint8Array(ENTROPY_BYTES);
  private bit = 0;

  push(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) {
      if ((value >> i) & 1) this.bytes[this.bit >> 3]! |= 0x80 >> (this.bit & 7);
      this.bit++;
    }
  }

  get position(): number {
    return this.bit;
  }

  /** Bits pushed so far, oldest first. */
  bits(): number[] {
    const out: number[] = new Array(this.bit);
    for (let i = 0; i < this.bit; i++) out[i] = (this.bytes[i >> 3]! >> (7 - (i & 7))) & 1;
    return out;
  }
}

function toBytes(bits: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(ENTROPY_BYTES);
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3]! |= 0x80 >> (i & 7);
  return bytes;
}

/** Pack 23 words into the 253 fixed entropy bits. */
export function packFixedBits(words: readonly string[]): BitWriter {
  if (words.length !== FIXED_MAX) {
    throw new RangeError(`expected ${FIXED_MAX} words, got ${words.length}`);
  }
  const w = new BitWriter();
  for (let i = 0; i < words.length; i++) {
    const idx = wordIndex(words[i]!);
    if (idx < 0) throw new Error(`word ${i + 1} is not in the wordlist: ${words[i]}`);
    w.push(idx, BITS_PER_WORD);
  }
  return w;
}

/**
 * The 8 valid finishing words for the given 23 words, in ascending word-index
 * order (so the same prefix always yields the same list in the same order).
 */
export interface EndingDetail {
  /** The finishing word. */
  word: string;
  /** The 3 free entropy bits this branch picks. */
  free: number;
  /** The checksum byte computed over the full entropy. */
  checksum: number;
  /** Full 32-byte entropy for this branch. */
  entropy: Uint8Array;
}

/** The 8 branches with the numbers behind them, for the UI and the explainer. */
export function endingDetails(words: readonly string[]): EndingDetail[] {
  const fixedBits = packFixedBits(words).bits();
  const out: EndingDetail[] = [];
  for (let free = 0; free < 1 << FREE_BITS; free++) {
    const bits = fixedBits.slice();
    for (let i = FREE_BITS - 1; i >= 0; i--) bits.push((free >> i) & 1);
    const entropy = toBytes(bits);
    const checksum = sha256(entropy)[0]!;
    out.push({ word: wordAt((free << CHECKSUM_BITS) | checksum), free, checksum, entropy });
  }
  return out;
}

export function endingCandidates(words: readonly string[]): string[] {
  return endingDetails(words).map((detail) => detail.word);
}

/** Fresh filler words from the platform CSPRNG (11 bits per word, no modulo bias). */
export function randomWords(count: number): string[] {
  if (count <= 0) return [];
  const bytes = randomBytes(count * 2);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    // 16 bits of input for 11 bits of output keeps the draw unbiased.
    const raw = ((bytes[i * 2]! << 8) | bytes[i * 2 + 1]!) & 0x7ff;
    out.push(wordAt(raw));
  }
  return out;
}

/** Fill slots `from..FIXED_MAX-1` with fresh randomness, leaving a chosen phrase intact. */
export function fillGaps(slots: readonly (string | null)[], from: number): (string | null)[] {
  const next = slots.slice();
  const start = Math.max(from, 0);
  const gaps: number[] = [];
  for (let i = start; i < FIXED_MAX; i++) if (!next[i]) gaps.push(i);
  const fillers = randomWords(gaps.length);
  gaps.forEach((slot, k) => {
    next[slot] = fillers[k]!;
  });
  return next;
}

/** Join 23 fixed words with a specific finishing word. */
export function phraseWith(words: readonly string[], ending: string): string {
  return [...words, ending].join(' ');
}

export function isValidPhrase(words: readonly string[]): boolean {
  if (words.length !== WORD_TOTAL) return false;
  return validateMnemonic(words.join(' '), WORDS as string[]);
}

/** Split pasted text into canonical words, keeping the raw pieces for error messages. */
export function parseWords(input: string): { words: string[]; unknown: { index: number; raw: string }[] } {
  const raw = input
    .normalize('NFKD')
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter((p) => p.length > 0);
  const unknown: { index: number; raw: string }[] = [];
  const words: string[] = [];
  raw.forEach((piece, index) => {
    const idx = wordIndex(piece);
    if (idx < 0) unknown.push({ index, raw: piece });
    else words.push(WORDS[idx]!);
  });
  return { words, unknown };
}

/** Entropy in bits, expressed for the UI warning bands. */
export function entropyVerdict(bits: number): { level: 'strong' | 'ok' | 'weak' | 'thin'; note: string } {
  if (bits >= 128) return { level: 'strong', note: 'At least as strong as a full 12-word seed.' };
  if (bits >= 96) return { level: 'ok', note: 'Comfortable for a vanity address you will reuse.' };
  if (bits >= 64) return { level: 'weak', note: 'Fine for small balances; use a passphrase or fewer fixed words.' };
  return { level: 'thin', note: 'Guessable if an attacker knows your word habit. Add filler words.' };
}