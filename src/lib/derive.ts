/**
 * Key derivation and address encoding for the three supported single-key
 * target types, all Bitcoin mainnet.
 *
 * Pure derivation only: no signing, no network, no wallet state.
 */
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58check } from '@scure/base';
import { Address, p2pkh, p2tr, p2wpkh, WIF } from '@scure/btc-signer/payment.js';
import { NETWORK, taprootTweakPrivKey } from '@scure/btc-signer/utils.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import { WORDS } from './words.js';

export type AddressType = 'segwit' | 'legacy' | 'taproot';

export interface AddressTypeInfo {
  id: AddressType;
  label: string;
  short: string;
  purpose: number;
  hint: string;
}

export const ADDRESS_TYPES: readonly AddressTypeInfo[] = [
  {
    id: 'segwit',
    label: 'Native SegWit',
    short: 'bc1q',
    purpose: 84,
    hint: 'BIP84 · cheapest fees · widest modern wallet support',
  },
  {
    id: 'legacy',
    label: 'Legacy',
    short: '1',
    purpose: 44,
    hint: 'BIP44 · oldest wallets and paper-sweep tools',
  },
  {
    id: 'taproot',
    label: 'Taproot',
    short: 'bc1p',
    purpose: 86,
    hint: 'BIP86 · smallest proofs, newest wallet support',
  },
];

export function typeInfo(type: AddressType): AddressTypeInfo {
  const info = ADDRESS_TYPES.find((t) => t.id === type);
  if (!info) throw new Error(`unknown address type: ${type}`);
  return info;
}

/** Account-level path, deriving `m/purpose'/0'/0'/0`. */
export function accountPath(type: AddressType): string {
  return `m/${typeInfo(type).purpose}'/0'/0'/0`;
}

export function addressPath(type: AddressType, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 0x7fffffff) {
    throw new RangeError(`address index out of range: ${index}`);
  }
  return `${accountPath(type)}/${index}`;
}

/** 64-byte BIP39 seed for the phrase (plus optional BIP39 passphrase). */
export function seedFor(words: readonly string[], passphrase = ''): Uint8Array {
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    throw new Error(`expected 12, 15, 18, 21 or 24 words, got ${words.length}`);
  }
  return mnemonicToSeedSync(words.join(' '), passphrase.normalize('NFKD'));
}

export function accountNode(seed: Uint8Array, type: AddressType): HDKey {
  return HDKey.fromMasterSeed(seed).derive(accountPath(type));
}

/** Address for a derived child node, encoded for `type`. */
export function addressOf(node: HDKey, type: AddressType): string {
  const pub = node.publicKey;
  if (!pub) throw new Error('node has no public key');
  switch (type) {
    case 'segwit':
      return p2wpkh(pub, NETWORK).address!;
    case 'legacy':
      return p2pkh(pub, NETWORK).address!;
    case 'taproot':
      return p2tr(pub.slice(1), undefined, NETWORK).address!;
  }
}

/**
 * Address for a key that is already BIP341-tweaked (an output key, as produced
 * by `tweakedWifOf`). No further tweak is applied.
 */
export function taprootAddressFromOutputKey(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, true).slice(1);
  return Address(NETWORK).encode({ type: 'tr', pubkey: pub });
}

/** Address for a bare private key (used by the verify screen). */
export function addressFromPrivateKey(privateKey: Uint8Array, type: AddressType): string {
  const node = new HDKey({ privateKey });
  return addressOf(node, type);
}

/** Address for a key whose compression flag is known, as WIF carries it. */
export function addressFromKey(privateKey: Uint8Array, type: AddressType, compressed: boolean): string {
  if (type !== 'legacy' || compressed) return addressFromPrivateKey(privateKey, type);
  const pub = secp256k1.getPublicKey(privateKey, false);
  return p2pkh(pub, NETWORK).address!;
}

/** Decode a mainnet WIF, keeping the compression flag the base58 payload carries. */
export function decodeWif(wif: string): { key: Uint8Array; compressed: boolean } {
  const bytes = base58check(sha256).decode(wif);
  if (bytes[0] !== 0x80) throw new Error('Not a mainnet WIF.');
  if (bytes.length === 34 && bytes[33] === 0x01) return { key: bytes.slice(1, 33), compressed: true };
  if (bytes.length === 33) return { key: bytes.slice(1), compressed: false };
  throw new Error('Malformed WIF payload.');
}

/** Compressed public key, hex, for the printable card. */
export function publicKeyHex(node: HDKey): string {
  const pub = node.publicKey;
  if (!pub) throw new Error('node has no public key');
  return bytesToHex(pub);
}

/** WIF of the HD private key at this node (compressed, mainnet). */
export function wifOf(node: HDKey): string {
  const priv = node.privateKey;
  if (!priv) throw new Error('node has no private key');
  return WIF(NETWORK).encode(priv);
}

/**
 * BIP341 output-key WIF. Only meaningful for taproot: a wallet that treats the
 * key as an output key (no re-tweak) lands on the displayed address.
 */
export function tweakedWifOf(node: HDKey): string {
  const priv = node.privateKey;
  if (!priv) throw new Error('node has no private key');
  return WIF(NETWORK).encode(taprootTweakPrivKey(priv));
}

export interface DerivedKey {
  type: AddressType;
  path: string;
  /** Address index this key came from. */
  index: number;
  address: string;
  publicKey: string;
  wif: string;
  tweakedWif?: string;
}

export function deriveAt(account: HDKey, type: AddressType, index: number): DerivedKey {
  const node = account.deriveChild(index);
  const base: DerivedKey = {
    type,
    path: addressPath(type, index),
    index,
    address: addressOf(node, type),
    publicKey: publicKeyHex(node),
    wif: wifOf(node),
  };
  if (type === 'taproot') base.tweakedWif = tweakedWifOf(node);
  return base;
}

/** Scheme-restricted character set, used for the difficulty estimate. */
export function searchAlphabet(type: AddressType): string {
  return type === 'legacy'
    ? '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    : '023456789acdefghjklmnpqrstuvwxyz';
}

export function normalizeTarget(type: AddressType, target: string): string {
  const t = target.trim();
  return type === 'legacy' ? t : t.toLowerCase();
}