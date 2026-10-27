import type { Screen } from '../router';
import { go, rerender } from '../router';
import { banner, copyButton, el, field, icon, ICONS } from '../dom';
import { entropyBits, state } from '../state';
import { WIF } from '@scure/btc-signer/payment.js';
import { NETWORK } from '@scure/btc-signer/utils.js';

import { encryptBip38, passphraseFeedback } from '../../lib/bip38';
import { typeInfo } from '../../lib/derive';
import { entropyVerdict } from '../../lib/mnemonic';
import { qrSvg } from '../../lib/qr';

async function seal(): Promise<void> {
  const derived = state.derived;
  if (!derived || state.exportState.busy) return;
  state.exportState.busy = true;
  state.exportState.error = null;
  rerender();
  try {
    const key = derived.type === 'taproot' && derived.tweakedWif ? derived.tweakedWif : derived.wif;
    const code = await encryptBip38(wifToKey(key), derived.address, state.exportState.passphrase, true);
    // The user may have changed candidate while scrypt ran.
    if (state.derived !== derived) return;
    state.exportState.code = code;
  } catch (err) {
    state.exportState.error = err instanceof Error ? err.message : 'Encryption failed.';
  } finally {
    state.exportState.busy = false;
    rerender();
  }
}

/** Decode the WIF we already hold back to a 32-byte key. */
function wifToKey(wif: string): Uint8Array {
  return WIF(NETWORK).decode(wif);
}

export function renderDetail(): Screen {
  const derived = state.derived;
  if (!derived) {
    return {
      title: 'Your new key',
      body: el('div', { class: 'card' }, el('p', { text: 'Nothing selected yet.' }), el('button', { onclick: () => go('build') }, 'Start over')),
      back: 'build',
    };
  }

  const words = state.phrase;
  const masked = !state.revealed;

  const phraseChips = el('div', { class: 'phrase' });
  words.forEach((word, index) => {
    phraseChips.append(
      el('span', {
        class: `w${index === 23 ? ' end' : ''}${masked ? ' hide' : ''}`,
        text: masked ? '' : `${index + 1}. ${word}`,
      }),
    );
  });

  const bits = entropyBits();
  const verdict = entropyVerdict(bits);

  const passInput = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'new-password',
    spellcheck: 'false',
    placeholder: 'BIP38 passphrase — memorise this',
    value: state.exportState.passphrase,
    oninput: (event: Event) => {
      state.exportState.passphrase = (event.target as HTMLInputElement).value;
      const note = document.getElementById('pass-note');
      if (note) {
        const feedback = passphraseFeedback(state.exportState.passphrase);
        note.textContent = feedback.note;
        note.className = `field-hint ${feedback.level}`;
      }
    },
  });

  const exportCard = el(
    'div',
    { class: 'card' },
    el('h2', { text: 'Seal the key (BIP38)' }),
    el('p', {
      class: 'tiny',
      text: 'scrypt N=16384 on this device takes a few seconds on a phone. The sealed key and the plain WIF are both shown: the sealed one is the safe backup, the WIF is for sweeping now.',
    }),
    el(
      'div',
      { class: 'noprint' },
      field('BIP38 passphrase', passInput),
      el('div', { id: 'pass-note', class: 'field-hint' }),
    ),
    el(
      'div',
      { class: 'row noprint', style: 'margin-top:10px' },
      el(
        'button',
        {
          class: 'primary',
          type: 'button',
          disabled: state.exportState.busy ? 'disabled' : null,
          onclick: () => void seal(),
        },
        state.exportState.busy ? 'Scrypting…' : state.exportState.code ? 'Seal again' : 'Seal with BIP38',
      ),
      state.exportState.code ? copyButton(state.exportState.code, 'Copy 6P key') : null,
    ),
    state.exportState.error ? banner('danger', state.exportState.error) : null,
    state.exportState.code
      ? el(
          'div',
          { class: 'stack', style: 'margin-top:12px' },
          banner('ok', 'Sealed. The QR below plus the passphrase is all a later sweep needs.'),
          qrSvg(state.exportState.code, 'BIP38 encrypted private key'),
          el('code', { class: 'mono', text: state.exportState.code }),
        )
      : null,
  );

  const body = el(
    'div',
    { class: 'stack' },
    el(
      'div',
      { class: 'card' },
      el('h2', { text: `Entropy: ${bits} bits (${verdict.level})` }),
      el('p', { class: 'tiny', text: `${state.fixedLen} words were yours, ${23 - state.fixedLen} were drawn at random. ${verdict.note}` }),
    ),
    el(
      'div',
      { class: 'card' },
      el('h2', { text: 'Phrase' }),
      phraseChips,
      el(
        'div',
        { class: 'row', style: 'margin-top:10px' },
        copyButton(words.join(' '), 'Copy all 24 words'),
        el(
          'button',
          {
            class: 'ghost small',
            type: 'button',
            onclick: () => {
              state.revealed = !state.revealed;
              rerender();
            },
          },
          icon(ICONS.eye, ''),
          state.revealed ? 'Hide' : 'Show',
        ),
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('h2', { text: `${typeInfo(derived.type).label} address` }),
      el('div', { class: 'row', style: 'justify-content:center' }, qrSvg(derived.address, 'Receive address')),
      el('code', { class: 'mono', text: derived.address }),
      el('div', { class: 'row', style: 'margin-top:10px' }, copyButton(derived.address, 'Copy address')),
    ),
    el(
      'div',
      { class: 'card' },
      el('h2', { text: derived.type === 'taproot' ? 'Internal key (BIP86)' : 'Private key' }),
      el('p', { class: 'tiny', text: 'Unsealed. Anyone who photographs this QR owns the coins.' }),
      el('div', { class: 'row', style: 'justify-content:center' }, qrSvg(derived.wif, 'WIF private key')),
      el('code', { class: 'mono', text: derived.wif }),
      derived.type === 'taproot'
        ? el(
            'div',
            { style: 'margin-top:10px' },
            el('p', { class: 'tiny', text: 'Output-key WIF (already BIP341-tweaked). Sweep tools that want the final key want this one; wallets that re-tweak want the internal one above.' }),
            el('code', { class: 'mono', text: derived.tweakedWif }),
            el('div', { class: 'row', style: 'margin-top:8px' }, copyButton(derived.tweakedWif!, 'Copy tweaked WIF')),
          )
        : null,
      derived.type === 'taproot'
        ? banner(
            'warn',
            el('strong', { text: 'Taproot + BIP38 caveat' }),
            'BIP38 has no field for the address type, so a generic importer derives a segwit/legacy address from the sealed key and reports a wrong passphrase. Sweep with the address shown here.',
          )
        : null,
    ),
    exportCard,
    el(
      'div',
      { class: 'card' },
      el('h2', { text: 'Technical' }),
      el(
        'dl',
        { class: 'kv' },
        el('dt', { text: 'Path' }),
        el('dd', { text: derived.path }),
        el('dt', { text: 'Public key' }),
        el('dd', { text: derived.publicKey }),
        el('dt', { text: 'Address index' }),
        el('dd', { text: String(derived.index) }),
        el('dt', { text: 'BIP39 passphrase' }),
        el('dd', { text: state.passphrase ? 'set' : 'none' }),
      ),
    ),
    el(
      'div',
      { class: 'card noprint' },
      el('h2', { text: 'Next' }),
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'ghost small', type: 'button', onclick: () => window.print() }, icon(ICONS.print, ''), 'Print card'),
        el(
          'button',
          {
            class: 'ghost small',
            type: 'button',
            onclick: () => {
              state.verify = {
                mode: 'phrase',
                phrase: words.join(' '),
                type: derived.type,
                passphrase: state.passphrase,
                key: state.exportState.code ?? derived.wif,
                index: String(derived.index),
                expected: derived.address,
                derivedAddress: '',
                result: null,
              };
              go('verify');
            },
          },
          icon(ICONS.check, ''),
          'Verify this key',
        ),
        el(
          'button',
          {
            class: 'ghost small danger',
            type: 'button',
            onclick: () => {
              if (!window.confirm('Clear the phrase from this screen?')) return;
              state.phrase = [];
              state.derived = null;
              state.candidates = [];
              state.exportState = { passphrase: '', code: null, busy: false, error: null };
              state.slots = Array(24).fill(null);
              state.fixedLen = 0;
              go('build');
            },
          },
          'Start over',
        ),
      ),
      el('p', { class: 'tiny', style: 'margin-top:10px', text: 'After printing, clear the screen and power the device down before leaving the room.' }),
    ),
    el('p', { class: 'tiny muted noprint', text: 'On a phone, copy the words into a text note, write down the BIP38 passphrase, then delete the note.' }),
  );

  return { title: 'Your new key', body, back: 'results' };
}

