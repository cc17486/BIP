import type { Screen } from '../router';
import { go } from '../router';
import { copyButton, el, icon, ICONS } from '../dom';
import { state, store } from '../state';

export function renderAirgap(): Screen {
  const ack = state.airgapAck;

  const body = el(
    'div',
    { class: 'stack' },
    el(
      'div',
      { class: 'card' },
      el('h2', { text: 'What this does' }),
      el('p', {
        text:
          'You choose up to 23 words of a 24-word BIP39 phrase. Only one word per 3-bit branch can follow, so your 23 words have exactly 8 valid endings — this tool finds them, derives an address for each, and can seal the key you pick with BIP38.',
      }),
      el('p', {
        text:
          'Nothing is fetched. The whole tool, the wordlist and every derivation live in this one file. The Content-Security-Policy allows no connections at all.',
      }),
    ),
    el(
      'div',
      { class: 'banner warn' },
      el('strong', { text: 'Before you trust it' }),
      'A chosen phrase is not random. Only the filler words add entropy, and the meter on the next screen says how much. Treat this as a hot-to-lukewarm key with a passphrase, not as a vault.',
    ),
    el(
      'div',
      { class: 'card' },
      el('h2', { text: 'Airgap checklist' }),
      el(
        'ol',
        { class: 'checklist' },
        el('li', { text: 'Airplane mode on; Wi-Fi, Bluetooth and hotspot off.' }),
        el('li', { text: 'Open this file from local storage, not from a link.' }),
        el('li', { text: 'Compare the build hash below against the one you copied with the file.' }),
        el('li', { text: 'Check the startup self-test seal in the top bar shows a count, not FAIL.' }),
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('h2', { text: 'Build hash' }),
      el('p', { text: 'Hash of the delivered file with the hash region zeroed. Verify with scripts/check-hash.mjs.' }),
      el('div', { class: 'row' }, el('code', { class: 'hash', text: state.hash }), copyButton(state.hash, 'Copy')),
    ),
    el(
      'label',
      { class: 'row card', style: 'gap:10px' },
      el('input', {
        type: 'checkbox',
        checked: state.rememberDraft || null,
        onchange: (event: Event) => {
          state.rememberDraft = (event.target as HTMLInputElement).checked;
          store.set('local', 'vanity.remember', state.rememberDraft ? 'yes' : null);
        },
      }),
      el('span', { class: 'tiny muted', text: 'Skip this screen next time (stores one flag in localStorage)' }),
    ),
    el(
      'div',
      { class: 'card row' },
      el('button', { class: 'ghost small', type: 'button', onclick: () => go('repair') }, 'Already have words? Fix the ending'),
      el('button', { class: 'ghost small', type: 'button', onclick: () => go('verify') }, 'Verify something'),
    ),
  );

  const bottom = el(
    'div',
    { class: 'bottombar' },
    el(
      'button',
      {
        class: 'primary',
        type: 'button',
        onclick: () => {
          state.airgapAck = true;
          store.set('session', 'vanity.airgap', 'yes');
          go('build');
        },
      },
      icon(ICONS.check, ''),
      ack ? 'Back to building' : 'I am airgapped — continue',
    ),
  );

  return { title: 'Airgap check', body, bottom, noMask: true };
}