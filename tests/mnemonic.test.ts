import { describe, expect, it } from 'vitest';

import {
  CHECKSUM_INDEX,
  endingCandidates,
  entropyVerdict,
  fillGaps,
  freeEntropyBits,
  isValidPhrase,
  packFixedBits,
  parseWords,
  phraseWith,
  randomWords,
  WORD_TOTAL,
} from '../src/lib/mnemonic';
import { WORDS, WORD_COUNT, suggest, wordAt, wordIndex, wordlistFingerprint } from '../src/lib/words';

const PREFIX = Array<string>(23).fill('abandon');

describe('wordlist', () => {
  it('ships 2048 words with the pinned fingerprint', () => {
    expect(WORD_COUNT).toBe(2048);
    expect(wordlistFingerprint()).toBe('187db04a869dd9bc7be80d21a86497d692c0db6abd3aa8cb6be5d618ff757fae');
  });

  it('resolves words and prefixes', () => {
    expect(wordIndex('abandon')).toBe(0);
    expect(wordAt(0)).toBe('abandon');
    expect(wordIndex('nope')).toBe(-1);
    expect(suggest('abandon')[0]).toBe('abandon');
    expect(suggest('zeb').length).toBeGreaterThan(0);
    expect(suggest('zeb')[0]!.startsWith('zeb')).toBe(true);
    expect(suggest('')).toEqual([]);
  });

  it('caps suggestions', () => {
    expect(suggest('a', 5).length).toBeLessThanOrEqual(5);
  });
});

describe('entropy budget', () => {
  it('counts 3 bits for a fully fixed 23-word prefix', () => {
    expect(freeEntropyBits(23)).toBe(3);
    expect(freeEntropyBits(22)).toBe(14);
    expect(freeEntropyBits(12)).toBe(124);
    expect(freeEntropyBits(0)).toBe(256);
  });

  it('bands the verdicts', () => {
    expect(entropyVerdict(3).level).toBe('thin');
    expect(entropyVerdict(70).level).toBe('weak');
    expect(entropyVerdict(100).level).toBe('ok');
    expect(entropyVerdict(128).level).toBe('strong');
  });
});

describe('ending candidates', () => {
  it('produces the documented eight for abandon x23', () => {
    expect(endingCandidates(PREFIX)).toEqual([
      'art',
      'diesel',
      'false',
      'kite',
      'organ',
      'ready',
      'surface',
      'trouble',
    ]);
  });

  it('always yields exactly 8 distinct, valid, prefix-preserving phrases', () => {
    for (let round = 0; round < 200; round++) {
      const prefix = randomWords(23);
      const endings = endingCandidates(prefix);
      expect(endings).toHaveLength(8);
      expect(new Set(endings).size).toBe(8);
      for (const ending of endings) {
        const phrase = [...prefix, ending];
        expect(phrase).toHaveLength(WORD_TOTAL);
        expect(isValidPhrase(phrase)).toBe(true);
        expect(phrase.slice(0, CHECKSUM_INDEX)).toEqual(prefix);
      }
    }
  });

  it('orders candidates by word index', () => {
    const indices = endingCandidates(PREFIX).map(wordIndex);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('rejects bad prefixes', () => {
    expect(() => endingCandidates(PREFIX.slice(0, 22))).toThrow();
    expect(() => endingCandidates([...PREFIX.slice(0, 22), 'notaword'])).toThrow(/not in the wordlist/);
    expect(packFixedBits(PREFIX).bits()).toHaveLength(253);
  });
});

describe('filler and parsing', () => {
  it('fills only empty slots from a given position', () => {
    const slots: (string | null)[] = Array(24).fill(null);
    slots[0] = 'zebra';
    slots[1] = 'otter';
    const filled = fillGaps(slots, 2);
    expect(filled[0]).toBe('zebra');
    expect(filled[1]).toBe('otter');
    for (let i = 2; i < 23; i++) expect(filled[i]).toMatch(/^[a-z]+$/);
    expect(filled[23]).toBeNull();
  });

  it('never fills a locked slot', () => {
    const slots: (string | null)[] = Array(24).fill(null);
    slots[5] = 'kite';
    const filled = fillGaps(slots, 0);
    expect(filled[5]).toBe('kite');
  });

  it('normalizes and reports unknown words by position', () => {
    const parsed = parseWords('  Zebra   KITE nope2\nkite ');
    expect(parsed.words).toEqual(['zebra', 'kite', 'kite']);
    expect(parsed.unknown).toEqual([{ index: 2, raw: 'nope2' }]);
  });

  it('random words stay inside the list', () => {
    for (const w of randomWords(64)) expect(WORDS).toContain(w);
    expect(randomWords(0)).toEqual([]);
  });

  it('builds phrases', () => {
    expect(phraseWith(['a', 'b'], 'c')).toBe('a b c');
  });
});
describe('random filler quality', () => {
  it('spreads draws across the whole list', () => {
    const buckets = new Array(16).fill(0);
    for (const word of randomWords(4096)) buckets[Math.floor(wordIndex(word) / 128)]! += 1;
    for (const count of buckets) {
      // 4096/16 = 256 expected; loose bounds catch a stuck or biased draw.
      expect(count).toBeGreaterThan(150);
      expect(count).toBeLessThan(380);
    }
  });

  it('does not repeat a single draw path', () => {
    const draws = new Set(Array.from({ length: 64 }, () => randomWords(1)[0]));
    expect(draws.size).toBeGreaterThan(50);
  });
});
