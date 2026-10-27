/**
 * Startup self-test.
 *
 * Cheap synchronous vectors run before the first paint and block it on
 * failure. The scrypt/BIP38 vector is slow, so it runs right after mount and
 * raises the same banner if it disagrees.
 */
import { base58check } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { p2pkh, p2tr, p2wpkh } from '@scure/btc-signer/payment.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';

import { addressHash, encryptBip38 } from './bip38';
import { endingCandidates, isValidPhrase } from './mnemonic';
import { wordlistFingerprint } from './words';

const b58 = base58check(sha256);

export interface SelfTestResult {
  ok: boolean;
  failures: string[];
  /** Fingerprint of the build, shown on the airgap screen. */
  checked: number;
}

function check(list: string[], name: string, fn: () => boolean): void {
  try {
    if (!fn()) list.push(name);
  } catch (err) {
    list.push(`${name} (${err instanceof Error ? err.message : 'threw'})`);
  }
}

const TWELVE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

export function runSyncChecks(): SelfTestResult {
  const failures: string[] = [];
  let checked = 0;

  const run = (name: string, fn: () => boolean): void => {
    checked++;
    check(failures, name, fn);
  };

  run('sha256', () => bytesToHex(sha256(new TextEncoder().encode('abc'))) ===
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  run('ripemd160', () => bytesToHex(ripemd160(new TextEncoder().encode('abc'))) ===
    '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc');
  run('base58check', () => b58.encode(Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04])) === '1An6UhWF92g');
  run('wordlist', () => wordlistFingerprint() === '187db04a869dd9bc7be80d21a86497d692c0db6abd3aa8cb6be5d618ff757fae');

  run('bip39 checksum', () => {
    const prefix = Array<string>(23).fill('abandon');
    const endings = endingCandidates(prefix);
    return endings.length === 8 && endings.includes('art') && isValidPhrase([...prefix, 'art']);
  });

  const master = HDKey.fromMasterSeed(mnemonicToSeedSync(TWELVE));
  run('bip32 depth', () => master.derive("m/84'/0'/0'/0/0").depth === 5);
  run('bip84 vector', () =>
    p2wpkh(master.derive("m/84'/0'/0'/0/0").publicKey!).address === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  run('bip86 vector', () =>
    p2tr(master.derive("m/86'/0'/0'/0/0").publicKey!.slice(1), undefined, undefined).address ===
    'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr');
  run('bip44 vector', () =>
    p2pkh(master.derive("m/44'/0'/0'/0/0").publicKey!).address === '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
  run('entropy source', () => {
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    crypto.getRandomValues(a);
    crypto.getRandomValues(b);
    return a.some((x) => x !== 0) && bytesToHex(a) !== bytesToHex(b);
  });

  return { ok: failures.length === 0, failures, checked };
}

const BIP38_VECTOR = {
  key: 'cbf4b9f70470856bb4f40f80b87edb90865997ffee6df315ab166d713af433a5',
  address: '1Jq6MksXQVWzrznvZzxkV6oY57oWXD9TXB',
  passphrase: 'TestingOneTwoThree',
  expected: '6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGg',
};

export async function runAsyncChecks(): Promise<string[]> {
  const failures: string[] = [];
  try {
    const code = await encryptBip38(hexToBytes(BIP38_VECTOR.key), BIP38_VECTOR.address, BIP38_VECTOR.passphrase, false);
    if (code !== BIP38_VECTOR.expected) failures.push('bip38 vector');
    if (bytesToHex(addressHash(BIP38_VECTOR.address)) !== 'e957a24a') failures.push('bip38 address hash');
  } catch (err) {
    failures.push(`bip38 threw (${err instanceof Error ? err.message : 'unknown'})`);
  }
  return failures;
}