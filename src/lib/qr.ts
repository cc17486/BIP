/** QR rendering. Always dark-on-white with a quiet zone, whatever the page theme. */
import { renderSVG } from 'uqr';

const BASE = { border: 3, pixelSize: 5, blackColor: '#000000', whiteColor: '#ffffff' } as const;

export function qrSvg(text: string, caption: string): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'qr';
  let svg: string;
  try {
    svg = renderSVG(text, { ...BASE, ecc: 'M' });
  } catch {
    // Long payload: drop correction so it still fits.
    svg = renderSVG(text, { ...BASE, ecc: 'L' });
  }
  figure.innerHTML = svg;
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  figure.append(cap);
  return figure;
}

/** Width in modules, used to keep small QRs from being blown up on desktop. */
export function qrModuleCount(text: string): number {
  const svg = renderSVG(text, { border: 0, pixelSize: 1, ecc: 'L' });
  const match = /viewBox="0 0 (\d+) /.exec(svg);
  return match ? Number(match[1]) : 0;
}