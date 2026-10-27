import type { Screen } from '../router';
import { go, rerender } from '../router';
import { banner, el, icon, ICONS } from '../dom';
import { clearGenerated, state } from '../state';
import { accountNode, deriveAt, seedFor, typeInfo } from '../../lib/derive';
import { chooseWords } from '../flow';
import { endingCandidates, isValidPhrase, parseWords, randomWords } from '../../lib/mnemonic';

let input = '';
let error: string | null = null;
let found: { ending: string; address: string }[] = [];
let prefix: string[] = [];
/** prefix plus the random filler drawn for this run: endings belong to this. */
let base: string[] = [];
let runInput = '';

function choose(ending: string): void {
  if (base.length !== 23) return;
  state.fixedLen = prefix.length;
  chooseWords([...base, ending], 0);
  go('detail');
}

function run(): void {
  const parsed = parseWords(input);
  error = null;
  found = [];
  if (parsed.unknown.length > 0) {
    error = `"${parsed.unknown[0]!.raw}" is not a BIP39 word (position ${parsed.unknown[0]!.index + 1}).`;
    rerender();
    return;
  }
  if (parsed.words.length === 0) {
    error = 'Paste some words first.';
    rerender();
    return;
  }
  if (parsed.words.length > 23) {
    if (parsed.words.length === 24) {
      if (isValidPhrase(parsed.words)) {
        state.fixedLen = 23;
        chooseWords(parsed.words, 0);
        go('detail');
        return;
      }
      error = 'Those 24 words are all real, but the checksum fails. Delete the last word and recreate the ending below.';
      input = parsed.words.slice(0, 23).join(' ');
      rerender();
      return;
    }
    error = 'Use at most 23 words; the 24th is the checksum.';
    rerender();
    return;
  }
  prefix = parsed.words;
  runInput = input;
  const filler = randomWords(23 - prefix.length);
  base = [...prefix, ...filler];
  found = endingCandidates(base).map((ending) => {
    const words = [...base, ending];
    const account = accountNode(seedFor(words, state.passphrase), state.addressType);
    return { ending, address: deriveAt(account, state.addressType, 0).address };
  });
  rerender();
}

export function renderRepair(): Screen {
  const box = el('textarea', {
    class: 'input mono',
    spellcheck: 'false',
    autocapitalize: 'none',
    placeholder: 'zebra kite …  (1 to 24 words)',
    value: input,
    oninput: (event: Event) => {
      input = (event.target as HTMLTextAreaElement).value;
      const note = document.getElementById('stale-note');
      if (note) note.hidden = !(found.length > 0 && input !== runInput);
    },
  });

  const body = el(
    'div',
    { class: 'stack' },
    banner(
      'info',
      el('strong', { text: 'Why this exists' }),
      'Old wallet, half-remembered phrase, or words typed in the wrong place: paste what you have and get the endings that make it valid. Nothing leaves the device.',
    ),
    error ? banner('danger', error) : null,
    el(
      'div',
      { class: 'card stack' },
      el('h2', { text: 'Words you already have' }),
      box,
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'primary', type: 'button', onclick: run }, icon(ICONS.check, ''), 'Check and complete'),
        el(
          'button',
          {
            class: 'ghost small',
            type: 'button',
            onclick: () => {
              input = '';
              found = [];
              error = null;
              rerender();
            },
          },
          'Clear',
        ),
      ),
      el('p', { class: 'tiny muted', text: `Endings are derived for ${typeInfo(state.addressType).label}; change the type on the build screen.` }),
    ),
    found.length > 0
      ? el(
          'div',
          { class: 'card' },
          el('h2', { text: 'Valid endings' }),
          el('p', { id: 'stale-note', class: 'banner warn', hidden: input === runInput ? 'hidden' : null, text: 'The box changed since this run. Run it again to match.' }),
          el('p', { class: 'tiny', text: `${prefix.length} of your words are kept. Pick the ending whose address you like, or keep the same words and try again for another filler.` }),
          el(
            'div',
            { class: 'stack' },
            ...found.map((item) =>
              el(
                'button',
                { class: 'opt', type: 'button', onclick: () => choose(item.ending) },
                el('div', { class: 'ending', text: item.ending }),
                el('div', { class: 'addr', text: item.address }),
              ),
            ),
          ),
        )
      : null,
    el(
      'div',
      { class: 'card' },
      el('p', { class: 'tiny', text: 'Pasted 24 words that are valid? It opens straight to the key. If only the last word is wrong, the tool shows the eight that would fit.' }),
    ),
  );

  const bottom = el('div', { class: 'bottombar' }, el('button', { class: 'ghost', type: 'button', onclick: () => { clearGenerated(); go('build'); } }, icon(ICONS.back, ''), 'Back to building'));

  return { title: 'Recreate endings', body, bottom, back: 'build', noMask: true };
}