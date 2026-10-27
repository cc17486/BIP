/** Minimal DOM helpers: no framework, no virtual DOM, explicit re-render. */

type Props = Record<string, unknown> | null;
type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = String(value);
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'html') node.innerHTML = String(value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key === 'dataset' && typeof value === 'object') {
        Object.assign(node.dataset, value as Record<string, string>);
      } else node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? String(child) : child);
  }
  return node;
}

export function mount(target: HTMLElement, ...children: Child[]): void {
  target.replaceChildren();
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    target.append(typeof child === 'string' || typeof child === 'number' ? String(child) : child);
  }
}

export function icon(path: string, label: string): HTMLSpanElement {
  const span = el('span', { class: 'icon', 'aria-hidden': label ? 'false' : 'true', role: 'img', 'aria-label': label });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  return span;
}

export const ICONS = {
  die: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M8 17h8v4H8z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
};

export async function copyText(text: string, button?: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // file:// or a denied permission: fall back to a throwaway selection.
    const area = el('textarea', { class: 'offscreen', readonly: 'readonly' });
    area.value = text;
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand?.('copy') ?? false;
    area.remove();
    if (!ok) {
      if (button) flash(button, 'Select manually');
      return false;
    }
  }
  if (button) flash(button, 'Copied');
  return true;
}

export function flash(node: HTMLElement, message: string): void {
  const previous = node.dataset.label ?? node.textContent ?? '';
  node.dataset.label = previous;
  if (node.dataset.timer) window.clearTimeout(Number(node.dataset.timer));
  node.textContent = message;
  node.dataset.timer = String(
    window.setTimeout(() => {
      node.textContent = node.dataset.label ?? previous;
      delete node.dataset.timer;
    }, 1400),
  );
}

export function copyButton(text: string, label = 'Copy'): HTMLButtonElement {
  const button = el('button', { class: 'ghost small', type: 'button' }, icon(ICONS.copy, ''), label);
  button.addEventListener('click', () => void copyText(text, button));
  return button;
}

export function banner(kind: 'info' | 'warn' | 'danger' | 'ok', ...children: Child[]): HTMLDivElement {
  return el('div', { class: `banner ${kind}`, role: kind === 'danger' ? 'alert' : 'status' }, ...children);
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  return el(
    'label',
    { class: 'field' },
    el('span', { class: 'field-label', text: label }),
    control,
    hint ? el('span', { class: 'field-hint', text: hint }) : null,
  );
}