import type { Screen } from '../router';
import { rerender, go } from '../router';
import { banner, copyButton, el, field, icon, ICONS } from '../dom';
import { state } from '../state';
import {
  ADDRESS_TYPES,
  accountNode,
  addressFromPrivateKey,
  addressOf,
  addressPath,
  seedFor,
  taprootAddressFromOutputKey,
  typeInfo,
} from '../../lib/derive';
import { addressFromKey, decodeWif } from '../../lib/derive';
import { decodeBip38, decryptBip38, hashesEqual, addressHash, Bip38Error } from '../../lib/bip38';
import { isValidPhrase, parseWords } from '../../lib/mnemonic';



function invalidate(): void {
  state.verify.result = null;
  state.verify.derivedAddress = '';
  document.getElementById('verify-result')?.remove();
  document.getElementById('copy-derived')?.remove();
}

async function check(): Promise<void> {
  const v = state.verify;
  const mode = v.mode;
  v.derivedAddress = '';
  const lines: string[] = [];
  let ok = false;

  try {
    if (v.mode === 'phrase') {
      const parsed = parseWords(v.phrase);
      if (parsed.unknown.length > 0) {
        lines.push(`Unknown word at position ${parsed.unknown[0]!.index + 1}: "${parsed.unknown[0]!.raw}".`);
      } else if (parsed.words.length !== 24) {
        lines.push(`Got ${parsed.words.length} words, expected 24.`);
      } else if (!isValidPhrase(parsed.words)) {
        lines.push('All 24 words are real, but the checksum fails. Recreate the ending with the Repair screen.');
      } else {
        const account = accountNode(seedFor(parsed.words, v.passphrase), v.type);
        const index = Math.max(0, Math.min(0x7fffffff, Number.parseInt(v.index, 10) || 0));
        const address = addressOf(account.deriveChild(index), v.type);
        lines.push(`Phrase is valid. Path ${addressPath(v.type, index)} derives:`);
        lines.push(address);
        ok = true;
        v.derivedAddress = address;
      }
    } else if (/^[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(v.key.trim())) {
      // Plain WIF: no passphrase involved, just show what it derives.
      const decodedWif = decodeWif(v.key.trim());
      const address = addressFromKey(decodedWif.key, v.type, decodedWif.compressed);
      lines.push(`WIF decoded (${decodedWif.compressed ? 'compressed' : 'uncompressed'}). ${typeInfo(v.type).label} address:`);
      lines.push(address);
      lines.push(
        decodedWif.compressed
          ? 'Compressed key: SegWit and Taproot are the natural destinations.'
          : 'Uncompressed key: legacy P2PKH is the only type that reproduces an uncompressed address.',
      );
      ok = true;
      v.derivedAddress = address;
    } else {
      const decoded = decodeBip38(v.key);
      const out = await decryptBip38(v.key, v.passphrase);
      const type = v.type;
      // The detail screen seals the BIP341 output key, so taproot is not re-tweaked here.
      const address = type === 'taproot' ? taprootAddressFromOutputKey(out.privateKey) : addressFromPrivateKey(out.privateKey, type);
      const hashMatches = hashesEqual(addressHash(address), decoded.addressHash);
      lines.push(`Sealed key decoded. Compression flag: ${decoded.compressed ? 'compressed' : 'uncompressed'}.`);
      lines.push(`Re-derived ${typeInfo(type).label} address: ${address}`);
      lines.push(hashMatches ? 'Address hash matches the sealed key.' : 'Address hash does NOT match — wrong passphrase, or a different address type was sealed.');
      if (out.compressed !== (type !== 'legacy')) {
        lines.push(`Note: the key was sealed as ${out.compressed ? 'compressed' : 'uncompressed'} but ${typeInfo(type).label} expects ${type !== 'legacy' ? 'compressed' : 'uncompressed'}.`);
      }
      ok = hashMatches;
    }

    if (v.expected.trim()) {
      const target = v.expected.trim();
      const match = v.derivedAddress === target || lines.includes(target);
      lines.push(match ? `Matches the expected address.` : `Does not match the expected address ${target}.`);
      ok = ok && match;
    }
  } catch (err) {
    ok = false;
    lines.push(err instanceof Bip38Error ? err.message : `Failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  v.result = { ok, detail: lines.join('\n') };
  rerender();
}

export function renderVerify(): Screen {
  const v = state.verify;

  const modeSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'What to check' });
  for (const m of [
    { id: 'phrase' as const, label: 'Words', hint: 'recompute the address' },
    { id: 'bip38' as const, label: 'Key', hint: '6P sealed or WIF' },
  ]) {
    modeSeg.append(
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(v.mode === m.id),
          onclick: () => {
            v.mode = m.id;
            v.result = null;
            rerender();
          },
        },
        m.label,
        el('span', { class: 'hint', text: m.hint }),
      ),
    );
  }

  const phraseBox = el('textarea', {
    class: 'input mono',
    spellcheck: 'false',
    autocapitalize: 'none',
    placeholder: '24 words, any whitespace',
    value: v.phrase,
    oninput: (event: Event) => {
      v.phrase = (event.target as HTMLTextAreaElement).value;
      invalidate();
    },
  });

  const keyBox = el('input', {
    class: 'input mono',
    spellcheck: 'false',
    autocapitalize: 'none',
    placeholder: '6P… sealed key, or a WIF',
    value: v.key,
    oninput: (event: Event) => {
      v.key = (event.target as HTMLInputElement).value;
      invalidate();
    },
  });

  const typeSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Address type' });
  for (const option of ADDRESS_TYPES) {
    typeSeg.append(
      el(
        'button',
        { type: 'button', 'aria-pressed': String(v.type === option.id), onclick: () => { v.type = option.id; v.result = null; rerender(); } },
        option.label,
      ),
    );
  }

  const passBox = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: v.mode === 'phrase' ? 'BIP39 passphrase, if you used one' : 'BIP38 passphrase',
    value: v.passphrase,
    oninput: (event: Event) => {
      v.passphrase = (event.target as HTMLInputElement).value;
      invalidate();
    },
  });

  const indexBox = el('input', {
    class: 'input mono',
    type: 'number',
    inputmode: 'numeric',
    min: '0',
    value: v.index,
    oninput: (event: Event) => {
      v.index = (event.target as HTMLInputElement).value;
      invalidate();
    },
  });

  const expected = el('input', {
    class: 'input mono',
    spellcheck: 'false',
    autocapitalize: 'none',
    placeholder: 'bc1q… (optional)',
    value: v.expected,
    oninput: (event: Event) => {
      v.expected = (event.target as HTMLInputElement).value;
      invalidate();
    },
  });

  const result = v.result
    ? el(
        'div',
        { class: v.result.ok ? 'banner ok' : 'banner danger', id: 'verify-result' },
        el('strong', { text: v.result.ok ? 'Matches' : 'Does not match' }),
        el('pre', { class: 'mono', style: 'white-space:pre-wrap;margin:6px 0 0', text: v.result.detail }),
      )
    : null;

  const body = el(
    'div',
    { class: 'stack' },
    banner('info', el('strong', { text: 'Checking is offline too' }), 'This runs the same derivation the generator runs. It never confirms anything against a node.'),
    el('div', { class: 'card' }, modeSeg),
    el(
      'div',
      { class: 'card stack' },
      v.mode === 'phrase' ? field('Phrase', phraseBox) : field('Key', keyBox),
      field(v.mode === 'phrase' ? 'BIP39 passphrase' : 'BIP38 passphrase (unused for a WIF)', passBox),
      v.mode === 'phrase' ? field('Address index', indexBox, 'The index used when the key was made. Default 0.') : null,
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Address type' }), typeSeg),
      field('Expected address', expected),
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'primary', type: 'button', onclick: () => void check() }, icon(ICONS.check, ''), 'Run the check'),
        v.derivedAddress ? el('span', { id: 'copy-derived' }, copyButton(v.derivedAddress, 'Copy derived address')) : null,
      ),
    ),
    result,
    el(
      'div',
      { class: 'card row' },
      el('button', { class: 'ghost small', type: 'button', onclick: () => go('build') }, icon(ICONS.back, ''), 'Back to building'),
      el(
        'button',
        {
          class: 'ghost small',
          type: 'button',
          onclick: () => {
            state.verify = { phrase: '', type: 'segwit', passphrase: '', key: '', index: '0', expected: '', derivedAddress: '', mode: 'phrase', result: null };
            rerender();
          },
        },
        'Clear',
      ),
    ),
  );

  return { title: 'Verify a phrase or key', body, back: 'build', noMask: true };
}