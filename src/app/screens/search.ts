import type { Screen } from '../router';
import { go, rerender } from '../router';
import { banner, copyButton, el, field, icon, ICONS } from '../dom';
import { fixedWords, resetSearchRun, state, type Hit } from '../state';
import { chooseWords } from '../flow';
import { searchAlphabet, typeInfo } from '../../lib/derive';
import { expectedAttempts, formatDuration, Search, type DoneReason } from '../../lib/search';
import { randomWords } from '../../lib/mnemonic';

let active: Search | null = null;

const BUDGETS = [
  { label: '30s', ms: 30_000 },
  { label: '2m', ms: 120_000 },
  { label: '10m', ms: 600_000 },
  { label: '∞', ms: Infinity },
];

/** Uniform enough for a search offset, but from the platform CSPRNG. */
function cryptoRandomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % max;
}

const DEPTHS = [
  { label: '2k', value: 2_000 },
  { label: '10k', value: 10_000 },
  { label: '50k', value: 50_000 },
];

/** Used by the router when the screen is left mid-run. */
export function abortSearch(): void {
  active?.stop();
  active = null;
  state.search.running = false;
}

function stop(reason: DoneReason = 'stopped'): void {
  active?.stop();
  active = null;
  state.search.running = false;
  state.search.message =
    reason === 'budget'
      ? 'Time budget used. Start again to keep going from a new random start.'
      : reason === 'full'
        ? 'Enough hits. Pick one below.'
        : reason === 'done'
          ? 'Every candidate address was tried.'
          : 'Stopped.';
  rerender();
}

function pick(hit: Hit): void {
  stop();
  chooseWords(hit.words, hit.index);
  go('detail');
}

export function renderSearch(): Screen {
  const fixed = fixedWords();
  const s = state.search;
  const info = typeInfo(state.addressType);
  const alphabet = searchAlphabet(state.addressType);
  const evidence = s.target ? expectedAttempts(s.target, alphabet.length, s.where) : 1;
  const rate = s.rate > 0 ? s.rate : 600;

  const updateEvidence = (): void => {
    const node = document.getElementById('evidence');
    if (!node) return;
    if (!s.target) {
      node.textContent = 'Type the characters you want to see how long it should take.';
      return;
    }
    const attempts = expectedAttempts(s.target, searchAlphabet(state.addressType).length, s.where);
    node.textContent = `Expected about ${Math.round(attempts).toLocaleString()} addresses — roughly ${formatDuration(
      (attempts / (s.rate > 0 ? s.rate : 600)) * 1000,
    )} at this device's pace.`;
  };

  const target = el('input', {
    class: 'input mono',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    placeholder: s.where === 'suffix' ? 'abc123' : 'bc1q… or just a few characters',
    value: s.target,
    oninput: (event: Event) => {
      s.target = (event.target as HTMLInputElement).value.trim();
      // No full re-render here: the input must keep the caret while typing.
      updateEvidence();
    },
  });

  const whereSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Match position' });
  for (const where of ['prefix', 'suffix', 'contains'] as const) {
    whereSeg.append(
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(s.where === where),
          onclick: () => {
            s.where = where;
            rerender();
          },
        },
        where === 'prefix' ? 'Starts with' : where === 'suffix' ? 'Ends with' : 'Contains',
        el('span', { class: 'hint', text: where === 'contains' ? 'easiest' : where === 'prefix' ? 'hardest' : '' }),
      ),
    );
  }

  const depthSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Addresses per ending' });
  for (const d of DEPTHS) {
    depthSeg.append(
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(s.depth === d.value),
          onclick: () => {
            s.depth = d.value;
            rerender();
          },
        },
        d.label,
      ),
    );
  }

  const budgetSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Time budget' });
  for (const b of BUDGETS) {
    budgetSeg.append(
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(s.budgetMs === b.ms),
          onclick: () => {
            s.budgetMs = b.ms;
            rerender();
          },
        },
        b.label,
      ),
    );
  }

  const varyBox = el('input', {
    type: 'checkbox',
    checked: s.varyFiller || fixed.length === 0 ? 'checked' : null,
    onchange: (event: Event) => {
      s.varyFiller = (event.target as HTMLInputElement).checked;
      rerender();
    },
  });

  const start = (): void => {
    if (s.running) return;
    if (!s.target) {
      s.message = 'Type the characters you want, first.';
      rerender();
      return;
    }
    s.running = true;
    s.tried = 0;
    s.hits = [];
    s.rate = 0;
    s.exhausted = false;
    s.message = '';
    active?.stop();
    active = new Search(
      {
        prefix: fixed,
        type: state.addressType,
        passphrase: state.passphrase,
        target: s.target,
        where: s.where,
        caseSensitive: state.addressType === 'legacy',
        startIndex: 1 + cryptoRandomInt(20_000),
        depth: s.depth,
        varyFiller: s.varyFiller || fixed.length === 0,
        budgetMs: s.budgetMs,
      },
      {
        onHit: (hit) => {
          s.hits = [hit, ...s.hits].slice(0, 20);
          rerender();
        },
        onProgress: (p) => {
          s.tried = p.tried;
          s.rate = p.rate;
          const node = document.getElementById('search-stats');
          if (node) {
            node.textContent = `${p.tried.toLocaleString()} tried · ${p.rate}/s · ${
              p.remaining === Infinity ? 'no limit' : `${Math.ceil(p.remaining / 1000)}s left`
            }`;
          }
        },
        onDone: (reason) => stop(reason),
      },
    );
    active.start();
    rerender();
  };

  const hits = el('div', { class: 'hits' });
  if (s.hits.length === 0) {
    hits.append(el('p', { class: 'tiny muted', text: s.running ? 'Nothing yet. Keep going.' : 'No hits yet.' }));
  }
  s.hits.forEach((hit) => {
    hits.append(
      el(
        'div',
        { class: 'hit' },
        el(
          'div',
          null,
          el('div', { class: 'addr', text: hit.address }),
          el('div', { class: 'tiny muted', text: `#${hit.index} · ${hit.words.slice(-1)[0]} · ${hit.path}` }),
        ),
        el('button', { class: 'small', type: 'button', onclick: () => pick(hit) }, 'Use'),
      ),
    );
  });

  const body = el(
    'div',
    { class: 'stack' },
    el(
      'div',
      { class: 'card' },
      el('h2', { text: 'Mine a prettier address' }),
      el('p', {
        class: 'tiny',
        text: `${fixed.length} fixed words. Each ending gets its own seed and then a run of address indexes, so the phrase stays and the address improves.`,
      }),
      field('Characters to match', target),
      whereSeg,
      el('div', { style: 'margin-top:12px' }, el('label', { class: 'row', style: 'gap:8px' }, varyBox, el('span', { class: 'tiny', text: 'Also regenerate the random filler words between runs' }))),
    ),
    state.addressType === 'taproot'
      ? banner('warn', 'Taproot mining is the slowest of the three here. Native segwit is cheaper per attempt.')
      : null,
    el(
      'div',
      { class: 'card' },
      el('h2', { text: 'Budget' }),
      el('p', { class: 'tiny', id: 'evidence', text: `Expected about ${Math.round(evidence).toLocaleString()} addresses — roughly ${formatDuration((evidence / rate) * 1000)} at this device's measured pace (${rate}/s).` }),
      el('span', { class: 'field-label', text: 'Addresses per ending' }),
      depthSeg,
      el('span', { class: 'field-label', text: 'Stop after' }),
      budgetSeg,
      el('p', { class: 'tiny muted', style: 'margin-top:8px', text: 'Address indexes are random-start, so record the index with the key — it is part of the recovery.' }),
    ),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'row', style: 'justify-content:space-between' }, el('h2', { text: 'Hits' }), el('span', { id: 'search-stats', class: 'stats', text: s.running ? `${s.tried} tried` : s.message || '' })),
      hits,
    ),
    banner('info', el('strong', { text: 'Four characters is plenty' }), 'A four-letter bech32 prefix is about 1 in a million — minutes of mining. Every extra character multiplies the wait by 32.'),
    el(
      'div',
      { class: 'card row' },
      el('button', { class: 'ghost small', type: 'button', onclick: () => go('build') }, 'Back to words'),
      el('button', { class: 'ghost small', type: 'button', onclick: () => { stop(); resetSearchRun(); rerender(); } }, icon(ICONS.refresh, ''), 'Reset list'),
    ),
  );

  const bottom = el(
    'div',
    { class: 'bottombar' },
    s.running
      ? el('button', { class: 'danger', type: 'button', onclick: () => stop() }, icon(ICONS.x, ''), 'Stop')
      : el('button', { class: 'primary', type: 'button', onclick: start }, icon(ICONS.search, ''), 'Start searching'),
    s.hits.length > 0 ? el('button', { class: 'ghost', type: 'button', onclick: () => pick(s.hits[0]!) }, 'Use best hit') : null,
  );

  return { title: 'Search an address', body, bottom, back: 'build' };
}

export { copyButton };