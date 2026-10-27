/**
 * English BIP39 wordlist access, with a prefix index for the on-screen picker.
 *
 * The wordlist is bundled from @scure/bip39, so the whole 2048-word set ships
 * inside the single HTML file. Nothing is fetched at runtime.
 */
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const WORDS: readonly string[] = wordlist;
export const WORD_COUNT = WORDS.length;

const indexOfWord = new Map<string, number>();
const byPrefix = new Map<string, number[]>();

for (let i = 0; i < WORDS.length; i++) {
  const w = WORDS[i]!;
  indexOfWord.set(w, i);
  // Prefix index from 1 char up to the full word, so "a", "ab", ... all resolve.
  for (let n = 1; n <= w.length; n++) {
    const p = w.slice(0, n);
    const bucket = byPrefix.get(p);
    if (bucket) bucket.push(i);
    else byPrefix.set(p, [i]);
  }
}

/** Canonical index of a word, or -1. */
export function wordIndex(word: string): number {
  return indexOfWord.get(word.trim().toLowerCase()) ?? -1;
}

export function wordAt(index: number): string {
  const w = WORDS[index];
  if (w === undefined) throw new RangeError(`word index out of range: ${index}`);
  return w;
}

/** Words starting with `prefix`, capped. Exact match first, then alphabetical. */
export function suggest(prefix: string, limit = 8): string[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];
  const hits = byPrefix.get(p) ?? [];
  const exact = indexOfWord.get(p);
  if (exact !== undefined) {
    const rest = hits.filter((i) => i !== exact).slice(0, limit - 1);
    return [WORDS[exact]!, ...rest.map((i) => WORDS[i]!)];
  }
  return hits.slice(0, limit).map((i) => WORDS[i]!);
}

/** Deterministic fingerprint of the bundled wordlist, pinned by the self-test. */
export function wordlistFingerprint(): string {
  const cleaned = WORDS.map((w) => w.normalize('NFKD'));
  return bytesToHex(sha256(new TextEncoder().encode(cleaned.join('\n'))));
}

/** True when the word exists and more than one word starts with it. */
export function isPrefixOfOthers(word: string): boolean {
  const p = word.trim().toLowerCase();
  return !indexOfWord.has(p) && (byPrefix.get(p)?.length ?? 0) > 0;
}