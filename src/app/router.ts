/** View dispatch and the persistent app chrome. */
import { banner, el, icon, mount, ICONS } from './dom';
import { state, type View } from './state';
import { renderAirgap } from './screens/airgap';
import { renderBuild } from './screens/build';
import { renderResults } from './screens/results';
import { renderDetail } from './screens/detail';
import { renderVerify } from './screens/verify';
import { renderRepair } from './screens/repair';
import { abortSearch, renderSearch } from './screens/search';

export interface Screen {
  title: string;
  body: HTMLElement;
  bottom?: HTMLElement;
  back?: View;
  /** Hide the reveal/mask toggle on screens without secret material. */
  noMask?: boolean;
}


export function go(view: View): void {
  if (state.view === 'search' && view !== 'search') abortSearch();
  const changed = state.view !== view;
  state.view = view;
  render();
  if (changed) {
    window.scrollTo({ top: 0 });
    document.querySelector<HTMLElement>('main h2')?.focus({ preventScroll: true });
  }
}

export function rerender(): void {
  render();
}

function screen(): Screen {
  switch (state.view) {
    case 'build':
      return renderBuild();
    case 'results':
      return renderResults();
    case 'detail':
      return renderDetail();
    case 'verify':
      return renderVerify();
    case 'repair':
      return renderRepair();
    case 'search':
      return renderSearch();
    default:
      return renderAirgap();
  }
}

function chrome(current: Screen): HTMLElement {
  const bar = el('header', { class: 'bar' });
  if (current.back) {
    const back = el('button', { class: 'ghost small', type: 'button', 'aria-label': 'Back' }, icon(ICONS.back, ''));
    back.addEventListener('click', () => go(current.back!));
    bar.append(back);
  }
  bar.append(el('h1', { text: current.title }));
  bar.append(el('div', { class: 'spacer' }));
  if (!current.noMask) {
    const toggle = el(
      'button',
      {
        class: 'ghost small',
        type: 'button',
        'aria-pressed': String(state.revealed),
        'aria-label': state.revealed ? 'Hide words' : 'Show words',
      },
      icon(ICONS.eye, ''),
      state.revealed ? 'Hide' : 'Show',
    );
    toggle.addEventListener('click', () => {
      state.revealed = !state.revealed;
      render();
    });
    bar.append(toggle);
  }
  const seal = el('span', {
    class: 'status',
    role: 'status',
    title: 'Startup derivation self-test',
    text: state.selfTest === 'ok' ? `${state.checked}✓` : state.selfTest === 'fail' ? 'FAIL' : '…',
  });
  bar.append(seal);
  return bar;
}

export function render(): void {
  const root = document.getElementById('app');
  if (!root) return;
  const current = screen();
  const main = el('main', null, current.body);
  if (state.selfTest === 'fail') {
    main.prepend(
      banner('danger', el('strong', { text: 'Do not use this build' }), 'Self-test disagreement: ', state.asyncFailures.join(', ')),
    );
  }
  mount(
    root,
    chrome(current),
    main,
    current.bottom ?? null,
    el(
      'footer',
      { class: 'foot' },
      el('div', { text: `${state.checked} derivation vectors + BIP38 vector checked at startup` }),
      el('div', { class: 'hash', text: `build ${state.hash}` }),
    ),
  );
  for (const heading of main.querySelectorAll('h2')) heading.setAttribute('tabindex', '-1');
}

export function fatal(title: string, detail: string[]): void {
  const root = document.getElementById('app');
  if (!root) return;
  mount(
    root,
    el('header', { class: 'bar' }, el('h1', { text: title })),
    el(
      'main',
      null,
      el('div', { class: 'banner danger' }, el('strong', { text: 'Do not use this build.' }), 'Derivation self-check failed.'),
      el('div', { class: 'card mono' }, ...detail.map((d) => el('div', { text: d }))),
      el('div', { class: 'card' }, el('p', { text: 'Reload, or rebuild from source and try again.' })),
    ),
  );
}

