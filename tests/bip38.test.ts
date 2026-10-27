import { describe, expect, it } from 'vitest';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  addressHash,
  Bip38Error,
  decodeBip38,
  decryptBip38,
  encryptBip38,
  hashesEqual,
  passphraseFeedback,
} from '../src/lib/bip38';
import { addressOf } from '../src/lib/derive';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { base58check } from '@scure/base';

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const b58 = base58check(sha256);
const uncompressedAddress = (key: Uint8Array) =>
  b58.encode(Uint8Array.from([0, ...ripemd160(sha256(secp256k1.getPublicKey(key, false)))]));

// BIP38 specification test vectors.
const V1 = {
  passphrase: 'TestingOneTwoThree',
  key: 'cbf4b9f70470856bb4f40f80b87edb90865997ffee6df315ab166d713af433a5',
  address: '1Jq6MksXQVWzrznvZzxkV6oY57oWXD9TXB',
  encrypted: '6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGg',
};

const V1_COMPRESSED = {
  passphrase: 'TestingOneTwoThree',
  key: V1.key,
  address: '164MQi977u9GUteHr4EPH27VkkdxmfCvGW',
  encrypted: '6PYNKZ1EAgYgmQfmNVamxyXVWHzK5s6DGhwP4J5o44cvXdoY7sRzhtpUeo',
};

const V2 = {
  passphrase: 'Satoshi',
  key: '09c2686880095b1a4c249ee3ac4eea8a014f11e6f986d0b5025ac1f39afbd9ae',
  address: '1AvKt49sui9zfzGeo8EyL8ypvAhtR2KwbL',
  encrypted: '6PRNFFkZc2NZ6dJqFfhRoFNMR9Lnyj7dYGrzdgXXVMXcxoKTePPX1dWByq',
};

// Non-ASCII passphrase vector: NFC normalization must happen before scrypt.
const V3 = {
  passphrase: '\u03D2\u0301\u0000\u{10400}\u{1F4A9}',
  key: toHex(hex('8064eeab5f9be2a01a8365a579511eb3373c87c40da6d2a25f05bda68fe077b66e').slice(1)),
  address: '16ktGzmfrurhbhi6JGqsMWf7TyqK9HNAeF',
  encrypted: '6PRW5o9FLp4gJDDVqJQKJFTpMvdsSGJxMYHtHaQBF3ooa8mwD69bapcDQn',
};

describe('BIP38 specification vectors', () => {
  it('encrypts vector 1 (uncompressed)', async () => {
    expect(await encryptBip38(hex(V1.key), V1.address, V1.passphrase, false)).toBe(V1.encrypted);
  });

  it('encrypts vector 1 (compressed)', async () => {
    expect(await encryptBip38(hex(V1_COMPRESSED.key), V1_COMPRESSED.address, V1_COMPRESSED.passphrase)).toBe(
      V1_COMPRESSED.encrypted,
    );
  });

  it('encrypts vector 2', async () => {
    expect(await encryptBip38(hex(V2.key), V2.address, V2.passphrase, false)).toBe(V2.encrypted);
  });

  it('encrypts vector 3 with Unicode NFC normalization', async () => {
    expect(await encryptBip38(hex(V3.key), V3.address, V3.passphrase, false)).toBe(V3.encrypted);
  });

  it('decrypts all vectors back to the key', async () => {
    for (const v of [V1, V2, V3]) {
      const out = await decryptBip38(v.encrypted, v.passphrase);
      expect(toHex(out.privateKey)).toBe(v.key);
      expect(out.compressed).toBe(false);
      expect(hashesEqual(out.addressHash, addressHash(v.address))).toBe(true);
    }
  });

  it('rejects a wrong passphrase once the address is re-derived', async () => {
    const out = await decryptBip38(V1.encrypted, 'WrongPassphrase');
    const rederived = uncompressedAddress(out.privateKey);
    expect(hashesEqual(out.addressHash, addressHash(rederived))).toBe(false);

    const good = await decryptBip38(V1.encrypted, V1.passphrase);
    expect(hashesEqual(good.addressHash, addressHash(uncompressedAddress(good.privateKey)))).toBe(true);
  });
});

describe('round trip', () => {
  const key = hex('cbf4b9f70470856bb4f40f80b87edb90865997ffee6df315ab166d713af433a5');
  const address = '164MQi977u9GUteHr4EPH27VkkdxmfCvGW';

  it('recovers a generated key for its own address', async () => {
    const code = await encryptBip38(key, address, 'correct horse battery staple');
    const out = await decryptBip38(code, 'correct horse battery staple');
    expect(toHex(out.privateKey)).toBe(toHex(key));
    expect(out.compressed).toBe(true);
  });

  it('rejects empty and oversized passphrases', async () => {
    await expect(encryptBip38(key, address, '')).rejects.toBeInstanceOf(Bip38Error);
    await expect(encryptBip38(key, address, 'x'.repeat(1025))).rejects.toBeInstanceOf(Bip38Error);
  });

  it('rejects wrong key sizes', async () => {
    await expect(encryptBip38(key.slice(1), address, 'pw')).rejects.toBeInstanceOf(Bip38Error);
  });

  it('is deterministic for the same inputs', async () => {
    const a = await encryptBip38(key, address, 'pw-passphrase');
    const b = await encryptBip38(key, address, 'pw-passphrase');
    expect(a).toBe(b);
  });
});

describe('decoding', () => {
  it('reads header, flag and hash', () => {
    const decoded = decodeBip38(V1.encrypted);
    expect(decoded.compressed).toBe(false);
    expect(hashesEqual(decoded.addressHash, addressHash(V1.address))).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(() => decodeBip38('6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGx')).toThrow(Bip38Error);
    expect(() => decodeBip38('not-a-key')).toThrow(Bip38Error);
  });

  it('rejects EC-multiplied keys', () => {
    expect(() => decodeBip38('6PfQu77ygVyJLZjfvMLyhLMQbYnu5uguoJJ4kMCLqWwPEdfpwANVS76gTX')).toThrow(/header/);
  });
});

describe('passphrase feedback', () => {
  it('grades by length and variety', () => {
    expect(passphraseFeedback('').level).toBe('thin');
    expect(passphraseFeedback('abc').level).toBe('thin');
    expect(passphraseFeedback('abcdefgh').level).toBe('weak');
    expect(passphraseFeedback('abcdefghijkl').level).toBe('ok');
    expect(passphraseFeedback('Correct-Horse-Battery9').level).toBe('strong');
  });
});

describe('taproot key material', () => {
  it('encrypts the output key so the address re-derives', async () => {
    const root = HDKey.fromMasterSeed(new Uint8Array(64).fill(7));
    const node = root.derive("m/86'/0'/0'/0/0");
    const address = addressOf(node, 'taproot');
    const code = await encryptBip38(node.privateKey!, address, 'taproot-passphrase');
    const out = await decryptBip38(code, 'taproot-passphrase');
    expect(hashesEqual(out.addressHash, addressHash(address))).toBe(true);
  });
});