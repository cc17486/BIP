import { chooseCandidate, generateCandidates } from '../flow';
import type { Screen } from '../router';
import { go, rerender } from '../router';
import { banner, el, icon, ICONS } from '../dom';
import {
  CHIP_MAX,
  clearGenerated,
  entropyBits,
  fillRest,
  fixedCount,
  fixedWords,
  pushWord,
  removeWord,
  resetSlots,
  state,
} from '../state';
import { ADDRESS_TYPES, typeInfo } from '../../lib/derive';
import { entropyVerdict, randomWords } from '../../lib/mnemonic';
import { suggest, wordIndex } from '../../lib/words';

function commit(raw: string): boolean {
  const word = raw.trim().toLowerCase();
  if (!word) return true;
  if (wordIndex(word) < 0) {
    state.error = `"${word}" is not a BIP39 word.`;
    return false;
  }
  if (!pushWord(word)) {
    state.error = `That is already ${CHIP_MAX} words. Keep the last slot free for the checksum.`;
    return false;
  }
  state.error = null;
  clearGenerated();
  return true;
}

async function generate(): Promise<void> {
  if (state.airgapAck === false) state.airgapAck = true;
  const fixed = fixedWords();
  if (fixed.length > CHIP_MAX) {
    state.error = 'Too many words.';
    return;
  }
  state.error = null;
  // Deriving eight seeds takes a moment on a phone: show it before blocking.
  const button = document.querySelector<HTMLButtonElement>('.bottombar button.primary');
  if (button) {
    button.disabled = true;
    button.textContent = 'Deriving addresses…';
  }
  await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
  generateCandidates();
  go('results');
}

/** Keep the caret in the word box across the re-render that follows a commit. */
function refocus(): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLInputElement>('input[aria-label="Add a word from the BIP39 list"]')?.focus();
  });
}

export function renderBuild(): Screen {
  const fixed = fixedWords();
  const bits = entropyBits();
  const verdict = entropyVerdict(bits);
  const info = typeInfo(state.addressType);

  const chips = el('div', { class: 'chips', role: 'list' });
  if (fixed.length === 0) {
    chips.append(el('span', { class: 'tiny muted', text: 'Type words below, or start with a random one.' }));
  }
  fixed.forEach((word, index) => {
    const chip = el(
      'span',
      { class: 'chip', role: 'listitem' },
      el('span', { class: 'num', text: String(index + 1) }),
      el('span', { text: word }),
      el(
        'button',
        {
          class: 'rm',
          type: 'button',
          'aria-label': `Remove ${word}`,
          onclick: () => {
            removeWord(index);
            clearGenerated();
            state.error = null;
            rerender();
          },
        },
        '×',
      ),
    );
    if (!state.revealed) chip.querySelector('span:nth-child(2)')!.textContent = '••••';
    chips.append(chip);
  });
  if (fixed.length < CHIP_MAX) {
    chips.append(
      el(
        'button',
        {
          class: 'ghost small',
          type: 'button',
          title: 'Append a random word',
          onclick: () => {
            const [word] = randomWords(1);
            if (word) pushWord(word);
            clearGenerated();
            rerender();
          },
        },
        icon(ICONS.die, ''),
        'Random word',
      ),
    );
  }

  const input = el('input', {
    class: 'input mono',
    type: 'text',
    inputmode: 'text',
    enterkeyhint: 'enter',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    placeholder: fixed.length === 0 ? 'e.g. zebra' : 'Next word…',
    'aria-label': 'Add a word from the BIP39 list',
  });

  const suggestions = el('div', { class: 'suggest', role: 'listbox', 'aria-label': 'Matching words' });

  const refreshSuggestions = (): void => {
    suggestions.replaceChildren();
    const value = input.value.trim().toLowerCase();
    if (!value) return;
    for (const word of suggest(value, 6)) {
      suggestions.append(
        el(
          'button',
          {
            type: 'button',
            class: 'suggestbtn',
            onclick: () => {
              if (commit(word)) {
                input.value = '';
                rerender();
                refocus();
              } else rerender();
            },
          },
          word,
        ),
      );
    }
  };

  input.addEventListener('input', () => {
    refreshSuggestions();
    const value = input.value;
    if (value.endsWith(' ')) {
      if (commit(value)) {
        input.value = '';
        suggestions.replaceChildren();
        rerender();
        refocus();
      }
    }
  });
  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (commit(input.value)) {
        input.value = '';
        rerender();
        refocus();
      } else rerender();
    }
  });

  const typeSegment = el('div', { class: 'seg', role: 'group', 'aria-label': 'Address type' });
  for (const option of ADDRESS_TYPES) {
    typeSegment.append(
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(option.id === state.addressType),
          onclick: () => {
            state.addressType = option.id;
            clearGenerated();
            rerender();
          },
        },
        option.label,
        el('span', { class: 'hint', text: option.hint }),
      ),
    );
  }

  const pass = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Optional BIP39 passphrase (25th word)',
    value: state.passphrase,
    oninput: (event: Event) => {
      state.passphrase = (event.target as HTMLInputElement).value;
      clearGenerated();
    },
  });

  const passDetails = el(
    'details',
    { class: 'card' },
    el('summary', { text: 'Advanced: BIP39 passphrase' }),
    el('p', { class: 'tiny', text: 'Shifts every address for the same words. Losing it loses the funds; there is no checksum on it.' }),
    pass,
  );

  const body = el(
    'div',
    { class: 'stack' },
    state.error ? banner('danger', state.error) : null,
    el(
      'div',
      { class: 'card' },
      el('h2', { text: `Your phrase (${fixed.length} of ${CHIP_MAX} words)` }),
      el('p', { class: 'tiny', text: 'Word 24 is the checksum: it is not chosen, it is computed. Whatever is left empty gets random words.' }),
      chips,
      el('div', { style: 'margin-top:10px' }, input, suggestions),
      el(
        'div',
        { class: 'row', style: 'margin-top:10px' },
        el(
          'button',
          {
            class: 'ghost small',
            type: 'button',
            onclick: () => {
              fillRest();
              clearGenerated();
              rerender();
            },
          },
          icon(ICONS.die, ''),
          'Randomise all empty slots',
        ),
        el(
          'button',
          {
            class: 'ghost small',
            type: 'button',
            onclick: () => {
              resetSlots();
              clearGenerated();
              state.error = null;
              rerender();
            },
          },
          icon(ICONS.trash, ''),
          'Clear',
        ),
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('h2', { text: 'Entropy' }),
      el('div', { class: `meter ${verdict.level}` }, el('span', { style: `width:${Math.min(100, (bits / 256) * 100)}%` })),
      el('p', { class: 'tiny', style: 'margin-top:8px' }, el('strong', { text: `${bits} bits` }), ` — ${verdict.note}`),
      bits < 64 ? el('p', { class: 'tiny', text: 'Under 64 bits. Fine to experiment with, weak for savings.' }) : null,
    ),
    el('div', { class: 'card' }, el('h2', { text: 'Address type' }), typeSegment, el('p', { class: 'tiny', text: info.hint })),
    passDetails,
    el(
      'div',
      { class: 'card row' },
      el('button', { class: 'ghost small', type: 'button', onclick: () => go('repair') }, 'Repair existing words'),
      el('button', { class: 'ghost small', type: 'button', onclick: () => go('search') }, icon(ICONS.search, ''), 'Search address'),
    ),
  );

  const bottom = el(
    'div',
    { class: 'bottombar' },
    el(
      'button',
      { class: 'primary', type: 'button', onclick: () => void generate() },
      `Show the ${8} valid endings`,
    ),
  );

  if (fixed.length === 0) bottom.querySelector('button')!.textContent = 'Fill randomly and show endings';

  return { title: 'Build your phrase', body, bottom, back: 'airgap', noMask: false };
}
