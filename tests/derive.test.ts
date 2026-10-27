import { describe, expect, it } from 'vitest';
import { HDKey } from '@scure/bip32';

import {
  accountPath,
  addressOf,
  addressPath,
  ADDRESS_TYPES,
  deriveAt,
  normalizeTarget,
  searchAlphabet,
  seedFor,
  wifOf,
} from '../src/lib/derive';
import { endingCandidates } from '../src/lib/mnemonic';
import { mnemonicToSeedSync } from '@scure/bip39';
import { WIF } from '@scure/btc-signer/payment.js';

const TWELVE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// 24 words: the app only ever handles 24, and this is the canonical all-zero prefix.
const MNEMONIC = `${Array<string>(23).fill('abandon').join(' ')} art`;

function masterNode(): HDKey {
  return HDKey.fromMasterSeed(seedFor(MNEMONIC.split(' ')));
}

/** The published BIP39/BIP84/BIP86 vectors are 12-word phrases. */
function masterVector(): HDKey {
  return HDKey.fromMasterSeed(mnemonicToSeedSync(TWELVE));
}

describe('BIP39 seed', () => {
  it('matches the known 64-byte seed', () => {
    const seed = seedFor(MNEMONIC.split(' '));
    expect(seed).toHaveLength(64);
    const withTrezor = seedFor(TWELVE.split(' '), 'TREZOR');
    expect(Array.from(withTrezor.slice(0, 8))).toEqual([0xc5, 0x52, 0x57, 0xc3, 0x60, 0xc0, 0x7c, 0x72]);
  });

  it('changes with a BIP39 passphrase', () => {
    const a = seedFor(TWELVE.split(' '));
    const b = seedFor(TWELVE.split(' '), 'TREZOR');
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('normalizes the passphrase to NFKD', () => {
    const composed = seedFor(TWELVE.split(' '), '\u00e9');
    const decomposed = seedFor(TWELVE.split(' '), '\u0065\u0301');
    expect(Array.from(composed)).toEqual(Array.from(decomposed));
  });

  it('rejects the wrong word count', () => {
    expect(() => seedFor(['abandon'])).toThrow(/24/);
    expect(() => seedFor(TWELVE.split(' ').slice(0, 11))).toThrow(/expected/);
  });
});

describe('derivation paths', () => {
  it('uses the documented purposes', () => {
    expect(accountPath('segwit')).toBe("m/84'/0'/0'/0");
    expect(accountPath('legacy')).toBe("m/44'/0'/0'/0");
    expect(accountPath('taproot')).toBe("m/86'/0'/0'/0");
    expect(addressPath('segwit', 7)).toBe("m/84'/0'/0'/0/7");
  });

  it('rejects bad indices', () => {
    expect(() => addressPath('segwit', -1)).toThrow();
    expect(() => addressPath('segwit', 1.5)).toThrow();
    expect(() => addressPath('segwit', 0x80000000)).toThrow();
  });
});

describe('BIP84/BIP86/BIP44 vectors', () => {
  const root = masterVector();

  it('derives the BIP84 first address', () => {
    const node = root.derive("m/84'/0'/0'/0/0");
    expect(addressOf(node, 'segwit')).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  });

  it('derives the BIP86 first address', () => {
    const node = root.derive("m/86'/0'/0'/0/0");
    expect(addressOf(node, 'taproot')).toBe(
      'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
    );
  });

  it('derives the BIP44 first address', () => {
    const node = root.derive("m/44'/0'/0'/0/0");
    expect(addressOf(node, 'legacy')).toBe('1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
  });

  it('produces well-formed WIFs that round-trip', () => {
    const node = root.derive("m/84'/0'/0'/0/0");
    const wif = wifOf(node);
    expect(wif).toMatch(/^[KL]/);
    expect(wif).toHaveLength(52);
    expect(Array.from(WIF().decode(wif))).toEqual(Array.from(node.privateKey!));
  });

  it('exposes the tweaked WIF only for taproot', () => {
    const node = root.derive("m/86'/0'/0'/0/1");
    const derived = deriveAt(node, 'taproot', 1);
    expect(derived.tweakedWif).toBeDefined();
    expect(derived.tweakedWif).not.toBe(derived.wif);
    expect(derived.path).toBe("m/86'/0'/0'/0/1");
  });

  it('keeps address indexes distinct', () => {
    const node = root.derive(accountPath('segwit'));
    const a = deriveAt(node, 'segwit', 0).address;
    const b = deriveAt(node, 'segwit', 1).address;
    expect(a).not.toBe(b);
  });
});

describe('target helpers', () => {
  it('lists three types with matching prefixes', () => {
    expect(ADDRESS_TYPES.map((t) => t.id)).toEqual(['segwit', 'legacy', 'taproot']);
    expect(ADDRESS_TYPES.map((t) => t.short)).toEqual(['bc1q', '1', 'bc1p']);
  });

  it('lowercases only bech32 targets', () => {
    expect(normalizeTarget('segwit', '  ABC ')).toBe('abc');
    expect(normalizeTarget('legacy', '  ABC ')).toBe('ABC');
  });

  it('excludes hard-to-type characters from the estimate alphabet', () => {
    expect(searchAlphabet('legacy')).not.toContain('0');
    expect(searchAlphabet('legacy')).not.toContain('O');
    expect(searchAlphabet('segwit')).not.toContain('b');
  });
});

describe('integration with endings', () => {
  it('derives a distinct valid address for every ending of a prefix', () => {
    const prefix = MNEMONIC.split(' ').slice(0, 23);
    const node = masterNode().derive(accountPath('segwit'));
    const addresses = endingCandidates(prefix).map((ending) => {
      const words = [...prefix, ending];
      const acct = HDKey.fromMasterSeed(seedFor(words)).derive(accountPath('segwit'));
      return deriveAt(acct, 'segwit', 0).address;
    });
    expect(new Set(addresses).size).toBe(8);
    for (const a of addresses) expect(a.startsWith('bc1q')).toBe(true);
    expect(node.publicKey).toBeDefined();
  });
});
describe('taproot output-key helper', () => {
  it('lands on the same address as the tweaked key', async () => {
    const { taprootTweakPrivKey } = await import('@scure/btc-signer/utils.js');
    const node = masterNode().derive("m/86'/0'/0'/0/2");
    const tweaked = taprootTweakPrivKey(node.privateKey!);
    const { taprootAddressFromOutputKey } = await import('../src/lib/derive');
    expect(taprootAddressFromOutputKey(tweaked)).toBe(addressOf(node, 'taproot'));
  });
});

describe('WIF decoding', () => {
  const key = Uint8Array.from(
    'cbf4b9f70470856bb4f40f80b87edb90865997ffee6df315ab166d713af433a5'.match(/../g)!.map((h) => parseInt(h, 16)),
  );

  it('keeps the compression flag', async () => {
    const { decodeWif } = await import('../src/lib/derive');
    const { WIF } = await import('@scure/btc-signer/payment.js');
    const compressed = decodeWif(WIF().encode(key));
    expect(compressed.compressed).toBe(true);
    expect(Array.from(compressed.key)).toEqual(Array.from(key));
  });

  it('derives an uncompressed legacy address when the WIF says so', async () => {
    const { addressFromKey, addressFromPrivateKey } = await import('../src/lib/derive');
    const uncompressed = addressFromKey(key, 'legacy', false);
    const compressed = addressFromPrivateKey(key, 'legacy');
    expect(uncompressed).not.toBe(compressed);
    expect(uncompressed).toBe('1Jq6MksXQVWzrznvZzxkV6oY57oWXD9TXB');
    expect(compressed).toBe('164MQi977u9GUteHr4EPH27VkkdxmfCvGW');
  });

  it('rejects a testnet WIF and junk', async () => {
    const { decodeWif } = await import('../src/lib/derive');
    expect(() => decodeWif('cULrpoZGXiuC19Uhvykx7NugygA3k86b3hmdCeyvHYQZSxojGyXJ')).toThrow(/mainnet/);
    expect(() => decodeWif('notakey')).toThrow();
  });
});
