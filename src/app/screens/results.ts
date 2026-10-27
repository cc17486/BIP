import type { Screen } from '../router';
import { go, rerender } from '../router';
import { el, icon, ICONS } from '../dom';
import { clearGenerated, entropyBits, state } from '../state';
import { chooseCandidate } from '../flow';
import { typeInfo } from '../../lib/derive';
import { entropyVerdict } from '../../lib/mnemonic';

export function renderResults(): Screen {
  if (state.candidates.length === 0) {
    return {
      title: 'Eight valid endings',
      body: el('div', { class: 'card' }, el('p', { text: 'No phrase generated yet.' }), el('button', { onclick: () => go('build') }, 'Build one')),
      back: 'build',
    };
  }
  const prefix = state.slots.slice(0, 23) as string[];
  const bits = entropyBits();
  const verdict = entropyVerdict(bits);

  const choose = (index: number): void => {
    chooseCandidate(index);
    go('detail');
  };

  const list = el('div', { class: 'grid' });
  state.candidates.forEach((candidate, index) => {
    const button = el(
      'button',
      {
        class: 'opt',
        type: 'button',
        'aria-pressed': String(state.selected === index),
        onclick: () => choose(index),
      },
      el('div', { class: 'row', style: 'justify-content:space-between' }, el('span', { class: 'idx', text: `Ending ${index + 1} of 8` }), el('span', { class: 'ending', text: candidate.ending })),
      el('div', { class: 'addr', text: candidate.address }),
    );
    list.append(button);
  });

  const preview = el('div', { class: 'phrase' });
  prefix.forEach((word, index) => {
    preview.append(
      el('span', {
        class: `w${state.revealed ? '' : ' hide'}`,
        text: state.revealed ? `${index + 1}. ${word}` : '',
      }),
    );
  });
  preview.append(el('span', { class: 'w end', text: '…' }));

  const body = el(
    'div',
    { class: 'stack' },
    el(
      'div',
      { class: 'card' },
      el('h2', { text: 'Your first 23 words are locked. These are the only 8 endings.' }),
      preview,
      el('p', {
        class: 'tiny',
        text: `${bits} bits unknown to an attacker (${state.fixedLen} chosen, ${23 - state.fixedLen} drawn). Verdict: ${verdict.level}. Every ending here passes the BIP39 checksum.`,
      }),
    ),
    el('div', { class: 'card' }, el('h2', { text: `Addresses (${typeInfo(state.addressType).label})` }), el('p', { class: 'tiny', text: 'Pick the one you like. None of these are better or worse — only shorter to type.' }), list),
    el(
      'div',
      { class: 'card row' },
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
        state.revealed ? 'Hide words' : 'Show words',
      ),
      el('button', { class: 'ghost small', type: 'button', onclick: () => go('build') }, icon(ICONS.back, ''), 'Change the words'),
      el(
        'button',
        { class: 'ghost small', type: 'button', onclick: () => go('search') },
        icon(ICONS.search, ''),
        'Mine a prettier address',
      ),
    ),
  );

  const bottom = el(
    'div',
    { class: 'bottombar' },
    el(
      'button',
      { class: 'primary', type: 'button', onclick: () => choose(0) },
      'Take the first ending',
    ),
    el(
      'button',
      {
        class: 'ghost',
        type: 'button',
        onclick: () => {
          clearGenerated();
          go('build');
        },
      },
      'Redo',
    ),
  );

  return { title: 'Eight valid endings', body, bottom, back: 'build' };
}