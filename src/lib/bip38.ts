/**
 * BIP38 (non-EC-multiplied) private-key encryption.
 *
 * Layout of the 39-byte payload, before Base58Check:
 *   0x01 0x42 | flagbyte | addresshash(4) | AES256(ECB) half1 | AES256(ECB) half2
 *
 * flagbyte 0xC0 = uncompressed, 0xE0 = compressed. The hash is
 * SHA256(SHA256(utf8(address)))[0..3] and doubles as the scrypt salt, which is
 * what lets a decryptor reject a wrong passphrase.
 */
import { ecb } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { base58check } from '@scure/base';

const FLAG_COMPRESSED = 0xe0;
const FLAG_UNCOMPRESSED = 0xc0;
const PAYLOAD_BYTES = 39;
const SCRYPT = { N: 16384, r: 8, p: 8, dkLen: 64 } as const;

const b58 = base58check(sha256);
const utf8 = new TextEncoder();

export class Bip38Error extends Error {
  override name = 'Bip38Error';
}

export interface DecodedBip38 {
  compressed: boolean;
  addressHash: Uint8Array;
  /** 32-byte encrypted key material (two 16-byte halves, still encrypted). */
  encrypted: Uint8Array;
}

export function addressHash(address: string): Uint8Array {
  return sha256(sha256(utf8.encode(address))).slice(0, 4);
}

function assertPassphrase(passphrase: string): void {
  if (passphrase.length === 0) throw new Bip38Error('Passphrase is empty.');
  if (passphrase.length > 1024) throw new Bip38Error('Passphrase is longer than 1024 characters.');
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<{ d1: Uint8Array; d2: Uint8Array }> {
  const key = await scryptAsync(utf8.encode(passphrase.normalize('NFC')), salt, SCRYPT);
  return { d1: key.slice(0, 32), d2: key.slice(32, 64) };
}

function encryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
  // Noble v2 block ciphers are single-use: fresh instance per block.
  return ecb(key, { disablePadding: true }).encrypt(block);
}

function decryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
  return ecb(key, { disablePadding: true }).decrypt(block);
}

/** Encrypt a 32-byte private key for the given address. */
export async function encryptBip38(
  privateKey: Uint8Array,
  address: string,
  passphrase: string,
  compressed = true,
): Promise<string> {
  if (privateKey.length !== 32) throw new Bip38Error('Private key must be 32 bytes.');
  if (!address) throw new Bip38Error('An address is required.');
  assertPassphrase(passphrase);

  const hash = addressHash(address);
  const { d1, d2 } = await deriveKey(passphrase, hash);

  const half1 = new Uint8Array(16);
  const half2 = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    half1[i] = privateKey[i]! ^ d1[i]!;
    half2[i] = privateKey[i + 16]! ^ d1[i + 16]!;
  }

  const out = new Uint8Array(PAYLOAD_BYTES);
  out[0] = 0x01;
  out[1] = 0x42;
  out[2] = compressed ? FLAG_COMPRESSED : FLAG_UNCOMPRESSED;
  out.set(hash, 3);
  out.set(encryptBlock(d2, half1), 7);
  out.set(encryptBlock(d2, half2), 23);
  return b58.encode(out);
}

/** Parse an encrypted key without touching scrypt. */
export function decodeBip38(code: string): DecodedBip38 {
  const trimmed = code.trim();
  let bytes: Uint8Array;
  try {
    bytes = b58.decode(trimmed);
  } catch {
    throw new Bip38Error('Not a valid Base58Check string.');
  }
  if (bytes.length !== PAYLOAD_BYTES) {
    throw new Bip38Error(`Encrypted key is ${bytes.length} bytes, expected ${PAYLOAD_BYTES}.`);
  }
  if (bytes[0] !== 0x01 || bytes[1] !== 0x42) {
    throw new Bip38Error('Unexpected header; only non-EC-multiplied keys are supported.');
  }
  const flag = bytes[2]!;
  if (flag !== FLAG_COMPRESSED && flag !== FLAG_UNCOMPRESSED) {
    throw new Bip38Error(`Unsupported flag byte 0x${flag.toString(16)}.`);
  }
  return {
    compressed: flag === FLAG_COMPRESSED,
    addressHash: bytes.slice(3, 7),
    encrypted: bytes.slice(7, 39),
  };
}

export interface Bip38Decrypted {
  privateKey: Uint8Array;
  compressed: boolean;
  addressHash: Uint8Array;
}

/** Decrypt and return the raw key. The caller must still check the address hash. */
export async function decryptBip38(code: string, passphrase: string): Promise<Bip38Decrypted> {
  const decoded = decodeBip38(code);
  assertPassphrase(passphrase);

  const { d1, d2 } = await deriveKey(passphrase, decoded.addressHash);
  const key = new Uint8Array(32);
  const first = decryptBlock(d2, decoded.encrypted.slice(0, 16));
  const second = decryptBlock(d2, decoded.encrypted.slice(16, 32));
  for (let i = 0; i < 16; i++) {
    key[i] = first[i]! ^ d1[i]!;
    key[i + 16] = second[i]! ^ d1[i + 16]!;
  }

  return { privateKey: key, compressed: decoded.compressed, addressHash: decoded.addressHash };
}

export function hashesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Rough strength hints for the passphrase field. */
export function passphraseFeedback(passphrase: string): { level: 'thin' | 'weak' | 'ok' | 'strong'; note: string } {
  const p = passphrase.normalize('NFC');
  if (p.length === 0) return { level: 'thin', note: 'Empty passphrase is allowed but adds almost nothing.' };
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length;
  const bits = Math.round(p.length * Math.log2(classes >= 3 ? 70 : classes === 2 ? 45 : 30));
  if (p.length >= 16 && classes >= 3) return { level: 'strong', note: `About ${bits} bits. Good.` };
  if (p.length >= 12) return { level: 'ok', note: `About ${bits} bits. Acceptable.` };
  if (p.length >= 8) return { level: 'weak', note: `About ${bits} bits. Long is better than clever.` };
  return { level: 'thin', note: `About ${bits} bits. Use four words or twelve-plus characters.` };
}