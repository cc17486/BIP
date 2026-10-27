// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { qrModuleCount, qrSvg } from '../src/lib/qr';
import { encryptBip38 } from '../src/lib/bip38';
import { addressHash } from '../src/lib/bip38';

const KEY = Uint8Array.from(
  'cbf4b9f70470856bb4f40f80b87edb90865997ffee6df315ab166d713af433a5'.match(/../g)!.map((h) => parseInt(h, 16)),
);
const ADDRESS = '164MQi977u9GUteHr4EPH27VkkdxmfCvGW';

describe('QR rendering', () => {
  it('encodes a BIP38 key at medium correction', async () => {
    const code = await encryptBip38(KEY, ADDRESS, 'qr-test');
    expect(code).toHaveLength(58);
    const figure = qrSvg(code, 'sealed key');
    const svg = figure.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(figure.querySelector('figcaption')?.textContent).toBe('sealed key');
    expect(qrModuleCount(code)).toBeGreaterThan(20);
  });

  it('renders a WIF and an address', () => {
    for (const value of ['L3rS3VdGEA2Vxks2iTioDzZfo2TTVGdncMzG81SCeXjJRF3z2Lmf', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu']) {
      expect(qrSvg(value, 'x').querySelector('svg')).not.toBeNull();
    }
  });

  it('stays scannable-width for the longest payload we emit', () => {
    const longest = 'x'.repeat(120);
    expect(qrModuleCount(longest)).toBeGreaterThan(20);
    expect(qrSvg(longest, 'x').querySelector('svg')).not.toBeNull();
  });

  it('always paints dark on white, independent of the theme', () => {
    const svg = qrSvg('bc1qtest', 'x').innerHTML;
    expect(svg).toContain('#ffffff');
    expect(svg).toContain('#000000');
  });
});

describe('address hash', () => {
  it('is a stable 4 bytes', () => {
    const hash = addressHash(ADDRESS);
    expect(hash).toHaveLength(4);
    expect(addressHash(ADDRESS)).toEqual(hash);
  });

  it('differs per address', () => {
    expect(addressHash(ADDRESS)).not.toEqual(addressHash('1Jq6MksXQVWzrznvZzxkV6oY57oWXD9TXB'));
  });
});