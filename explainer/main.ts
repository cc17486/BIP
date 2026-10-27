import './style.css';

import * as THREE from 'three';
import { bytesToHex } from '@noble/hashes/utils.js';

import { accountNode, deriveAt, seedFor } from '../src/lib/derive';
import { endingDetails, randomWords } from '../src/lib/mnemonic';

// ---------------------------------------------------------------- data (real)

const PREFIX = ['zebra', 'kite', ...randomWords(21)];
const DETAILS = endingDetails(PREFIX);
const keys = DETAILS.map((detail) => {
  const words = [...PREFIX, detail.word];
  return deriveAt(accountNode(seedFor(words), 'segwit', 0), 'segwit', 0);
});
if (keys.length !== 8) throw new Error('expected eight branches');

/** The demo picks the shortest ending, so the finished phrase stays readable. */
const WINNER = DETAILS.reduce((best, d, i) => (d.word.length < DETAILS[best]!.word.length ? i : best), 0);

// ---------------------------------------------------------------- chrome

const stage = document.getElementById('stage')!;
const titleEl = document.getElementById('caption-title')!;
const bodyEl = document.getElementById('caption-body')!;
const actsEl = document.getElementById('acts')!;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const stepBtn = document.getElementById('step') as HTMLButtonElement;
const restartBtn = document.getElementById('restart') as HTMLButtonElement;
const fallback = document.getElementById('fallback')!;

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);
const isE2E = params.has('e2e');

const report = { ready: false, frames: 0, act: 0, rendered: false, triangles: 0, errors: [] as string[], webgl: false, resources: 0 };
(window as unknown as { __explain: typeof report }).__explain = report;
window.addEventListener('error', (event) => report.errors.push(String(event.message)));
window.addEventListener('unhandledrejection', (event) => report.errors.push(`rejection: ${String((event.reason as Error)?.message ?? event.reason)}`));

// ---------------------------------------------------------------- three setup

let renderer: THREE.WebGLRenderer;
try {
  const stillMode = params.has('still');
  renderer = new THREE.WebGLRenderer({
    antialias: !stillMode,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: stillMode,
  });
  report.webgl = true;
} catch {
  fallback.hidden = false;
  titleEl.textContent = 'WebGL is unavailable';
  bodyEl.textContent = 'Open this page in a browser with hardware or software 3D enabled.';
  report.errors.push('webgl unavailable');
  report.ready = true;
  document.title = `EXPLAIN:${JSON.stringify(report)}`;
  throw new Error('no webgl');
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
stage.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#060a0d');
scene.fog = new THREE.Fog('#060a0d', 16, 34);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 0.4, 16);


// ---------------------------------------------------------------- textures

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wordTexture(word: string, index: number, kind: 'chosen' | 'filler' | 'ending' | 'ghost'): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 340);
  const accent = kind === 'ending' || kind === 'ghost';
  ctx.fillStyle = accent ? '#16282a' : kind === 'chosen' ? '#1b2a34' : '#131c23';
  roundRect(ctx, 8, 8, 496, 324, 40);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = accent ? '#4fd1c5' : '#2b3a45';
  ctx.stroke();

  ctx.fillStyle = '#7f95a3';
  ctx.font = `500 34px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(String(index + 1).padStart(2, '0'), 34, 62);

  let size = 92;
  ctx.font = `650 ${size}px ${FONT}`;
  const max = 400;
  while (ctx.measureText(word).width > max && size > 40) {
    size -= 6;
    ctx.font = `650 ${size}px ${FONT}`;
  }
  ctx.fillStyle = accent ? '#8ff0e4' : kind === 'chosen' ? '#dff1f7' : '#a7bcc9';
  ctx.textAlign = 'center';
  ctx.fillText(word, 256, 200);

  if (kind === 'filler') {
    ctx.fillStyle = '#5b7382';
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText('drawn at random', 256, 268);
  }

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function hexTexture(bytes: Uint8Array, highlight: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 220);
  ctx.fillStyle = '#0d151b';
  roundRect(ctx, 8, 8, 496, 204, 28);
  ctx.fill();
  ctx.strokeStyle = '#2b3a45';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = '#6e8797';
  ctx.font = `500 26px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('SHA-256(entropy) → first byte', 256, 52);

  ctx.font = `600 46px ui-monospace, monospace`;
  const text = bytesToHex(bytes);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i === highlight ? '#8ff0e4' : '#546975';
    ctx.fillText(text.slice(i * 2, i * 2 + 2), 150 + i * 72, 132);
  }
  ctx.fillStyle = '#41525d';
  ctx.font = `500 24px ${FONT}`;
  ctx.fillText('…', 440, 132);

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function plateTexture(line1: string, line2: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 420);
  ctx.fillStyle = '#0b1318';
  roundRect(ctx, 6, 6, 1012, 408, 44);
  ctx.fill();
  ctx.strokeStyle = '#4fd1c5';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#7f95a3';
  ctx.font = `500 34px ${FONT}`;
  ctx.fillText('the only thing you share', 512, 92);

  let size = 54;
  ctx.font = `600 ${size}px ui-monospace, monospace`;
  while (ctx.measureText(line1).width > 940 && size > 26) {
    size -= 3;
    ctx.font = `600 ${size}px ui-monospace, monospace`;
  }
  ctx.fillStyle = '#a8f3e9';
  ctx.fillText(line1, 512, 218);

  ctx.fillStyle = '#5f7784';
  ctx.font = `500 30px ui-monospace, monospace`;
  ctx.fillText(line2, 512, 296);

  ctx.fillStyle = '#41525d';
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText('spendable with the phrase, useless without it', 512, 356);

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------- scene objects

const COLS = 4;
const ROWS = 6;
const GAP_X = 0.22;
const GAP_Y = 0.2;
const TILE_W = 1.32;
const TILE_H = 0.88;

const grid = new THREE.Group();
grid.position.y = 1.15;
scene.add(grid);

interface Tile {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  label: string;
}

const tiles: Tile[] = [];

function tileGeometry(): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(TILE_W, TILE_H, 0.07);
  return geometry;
}

for (let i = 0; i < 24; i++) {
  const chosen = i < 23;
  const word = chosen ? PREFIX[i]! : '…';
  const material = new THREE.MeshBasicMaterial({
    map: wordTexture(word, i, i < 2 ? 'chosen' : 'filler'),
    transparent: true,
    opacity: 0,
  });
  const mesh = new THREE.Mesh(tileGeometry(), material);
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  mesh.position.set((col - (COLS - 1) / 2) * (TILE_W + GAP_X), -(row - (ROWS - 1) / 2) * (TILE_H + GAP_Y), 0);
  mesh.rotation.y = (col - (COLS - 1) / 2) * 0.045;
  grid.add(mesh);
  tiles.push({ mesh, material, label: word });
}

// slot 24: hollow until filled
const slot = tiles[23]!;
slot.material.map?.dispose();
slot.material.map = wordTexture('?', 23, 'ending');
slot.material.color.set('#e6fffb');

// bit strip above the grid
const bitStrip = new THREE.Group();
bitStrip.position.set(0, 4.55, 0.2);
scene.add(bitStrip);

interface Bit {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  free: boolean;
}
const bits: Bit[] = [];
for (let i = 0; i < 11; i++) {
  const free = i < 3;
  const material = new THREE.MeshBasicMaterial({
    color: free ? '#4fd1c5' : '#3b4b57',
    transparent: true,
    opacity: 0,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.14), material);
  mesh.position.x = (i - 5) * 0.46;
  bitStrip.add(mesh);
  bits.push({ mesh, material, free });
}

const bitLabel = new THREE.Mesh(
  new THREE.PlaneGeometry(2.4, 0.34),
  new THREE.MeshBasicMaterial({
    map: (() => {
      const [c, ctx] = canvas(720, 100);
      ctx.fillStyle = '#7f95a3';
      ctx.font = `500 34px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('3 free bits + 8 checksum bits', 360, 60);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })(),
    transparent: true,
    opacity: 0,
  }),
);
bitLabel.position.set(0, 5.05, 0.2);
scene.add(bitLabel);

// branch row
const branchGroup = new THREE.Group();
branchGroup.position.set(0, -3.15, 1.2);
scene.add(branchGroup);

interface Branch {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  hex: THREE.Mesh;
  hexMaterial: THREE.MeshBasicMaterial;
  detail: (typeof DETAILS)[number];
  index: number;
}
const branches: Branch[] = [];
const TOTAL_W = 8 * 1.16;
DETAILS.forEach((detail, i) => {
  const material = new THREE.MeshBasicMaterial({
    map: wordTexture(detail.word, 23, 'ghost'),
    transparent: true,
    opacity: 0,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 0.72), material);
  mesh.position.set(i * 1.16 - TOTAL_W / 2 + 0.58, 0, -Math.abs(i - 3.5) * 0.09);
  mesh.rotation.y = (i - 3.5) * -0.05;
  branchGroup.add(mesh);

  const hexMaterial = new THREE.MeshBasicMaterial({ map: hexTexture(detail.entropy, 0), transparent: true, opacity: 0 });
  const hex = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.42), hexMaterial);
  hex.position.set(mesh.position.x, -0.62, mesh.position.z);
  branchGroup.add(hex);

  branches.push({ mesh, material, hex, hexMaterial, detail, index: i });
});

// address plate
const plate = new THREE.Mesh(
  new THREE.PlaneGeometry(6.2, 2.55),
  new THREE.MeshBasicMaterial({ map: plateTexture(keys[WINNER]!.address, keys[WINNER]!.path), transparent: true, opacity: 0 }),
);
plate.position.set(0, 0.6, 2.4);
plate.visible = false;
scene.add(plate);

// particles
const COUNT = reduced ? 90 : 320;
const positions = new Float32Array(COUNT * 3);
for (let i = 0; i < COUNT; i++) {
  positions[i * 3] = (Math.random() - 0.5) * 26;
  positions[i * 3 + 1] = (Math.random() - 0.5) * 16;
  positions[i * 3 + 2] = (Math.random() - 0.5) * 12 - 4;
}
const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const particles = new THREE.Points(
  particleGeo,
  new THREE.PointsMaterial({ color: '#2f7f8c', size: 0.045, transparent: true, opacity: 0.55, depthWrite: false }),
);
scene.add(particles);

// ---------------------------------------------------------------- tween engine

interface Tween {
  t: number;
  duration: number;
  update: (k: number) => void;
  resolve: () => void;
  ease: (k: number) => number;
}

const tweens = new Set<Tween>();
let speed = 1;
let paused = false;
/** E2E collapses durations: virtual time does not drive requestAnimationFrame. */
let instant = false;

const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

function tween(duration: number, update: (k: number) => void, ease = easeOut): Promise<void> {
  if (instant) {
    update(1);
    return Promise.resolve();
  }
  const scale = reduced ? 0.35 : 1;
  return new Promise((resolve) => {
    const entry: Tween = { t: 0, duration: Math.max(0.05, duration * scale), update, resolve, ease };
    entry.update(0);
    tweens.add(entry);
  });
}

function fade(material: { opacity: number }, to: number, duration = 0.6): Promise<void> {
  const from = material.opacity;
  return tween(duration, (k) => {
    material.opacity = from + (to - from) * k;
  });
}

function wait(seconds: number): Promise<void> {
  return tween(seconds, () => undefined, (k) => k);
}

function stepTweens(dt: number): void {
  for (const entry of tweens) {
    entry.t += dt * speed;
    const k = Math.min(1, entry.t / entry.duration);
    entry.update(entry.ease(k));
    if (k >= 1) {
      tweens.delete(entry);
      entry.resolve();
    }
  }
}

function finishTweens(): void {
  for (const entry of tweens) {
    entry.update(1);
    tweens.delete(entry);
    entry.resolve();
  }
}

// ---------------------------------------------------------------- acts

interface Act {
  kicker: string;
  title: string;
  body: string;
  run: () => Promise<void>;
}

const ACTS: Act[] = [
  {
    kicker: 'BIP39',
    title: 'A seed phrase is a checksum of itself',
    body: 'Twenty-four words carry 256 random bits and an 8-bit checksum. The checksum is not a word you know — it falls out of the maths.',
    run: async () => {
      await tween(1.6, (k) => {
        particles.rotation.y = k * 0.12;
      });
    },
  },
  {
    kicker: 'Your part',
    title: 'You choose 23 of the 24 words',
    body: 'These are real tiles: two chosen words, then 21 drawn by the device. Nothing about them is random if you pick all 23 yourself — the meter in the generator says so.',
    run: async () => {
      for (let i = 0; i < 23; i++) {
        const tile = tiles[i]!;
        const from = tile.mesh.position.z;
        void fade(tile.material, 1, 0.35);
        await tween(0.05, () => undefined);
        void tween(0.5, (k) => {
          tile.mesh.position.z = from - 1.4 + k * 1.4;
        });
      }
      await wait(0.4);
      slot.material.opacity = 1;
    },
  },
  {
    kicker: 'The last word',
    title: 'Three free bits, eight checksum bits',
    body: 'An 11-bit word is the last 3 bits of entropy plus the 8 checksum bits. Fix the 23 words and only those 3 bits are yours to move — and moving them changes the checksum.',
    run: async () => {
      for (const bit of bits) void fade(bit.material, bit.free ? 0.95 : 0.8, 0.4);
      void fade(bitLabel.material, 0.85, 0.4);
      for (let round = 0; round < 4; round++) {
        await tween(0.28, (k) => {
          const lift = k < 0.5 ? k * 2 : (1 - k) * 2;
          for (const bit of bits) if (bit.free) bit.mesh.position.y = lift * 0.18;
        });
      }
      for (const bit of bits) bit.mesh.position.y = 0;
      slot.material.color.set('#ffffff');
    },
  },
  {
    kicker: 'Exactly eight',
    title: 'All eight combinations are valid',
    body: 'Each of the eight values of those 3 bits has exactly one checksum, so each yields exactly one word. Eight branches, eight valid phrases — you pick the one you like.',
    run: async () => {
      for (const branch of branches) {
        void fade(branch.material, 1, 0.5);
        void fade(branch.hexMaterial, 0.9, 0.5);
      }
      await wait(1.1);
      // Walk the row, then settle on the shortest word.
      for (let i = 0; i < 8; i++) {
        const branch = branches[i]!;
        await tween(0.18, (k) => {
          branch.hex.position.y = -0.62 + Math.sin(k * Math.PI) * 0.08;
        });
      }
      for (const [i, branch] of branches.entries()) {
        if (i === WINNER) continue;
        void tween(0.6, (k) => {
          branch.material.opacity = 1 - k * 0.62;
          branch.hexMaterial.opacity = 0.9 - k * 0.55;
        });
      }
      const winner = branches[WINNER]!;
      await tween(0.7, (k) => {
        winner.mesh.scale.setScalar(1 + k * 0.16);
        winner.material.color.setRGB(1, 0.86 + k * 0.14, 0.86 + k * 0.14);
      });
      // Move the chosen word into slot 24.
      const target = slot.mesh.getWorldPosition(new THREE.Vector3());
      const start = winner.mesh.getWorldPosition(new THREE.Vector3());
      slot.material.map?.dispose();
      slot.material.map = wordTexture(DETAILS[WINNER]!.word, 23, 'ending');
      slot.material.needsUpdate = true;
      const ghost = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 0.72), new THREE.MeshBasicMaterial({ map: winner.material.map!, transparent: true }));
      ghost.position.copy(start);
      scene.add(ghost);
      await tween(0.9, (k) => {
        ghost.position.lerp(target, k);
        ghost.scale.setScalar(1 - k * 0.15);
      });
      ghost.geometry.dispose();
      (ghost.material as THREE.MeshBasicMaterial).dispose();
      scene.remove(ghost);
    },
  },
  {
    kicker: 'Result',
    title: 'One phrase, one key, one address',
    body: 'The phrase is hashed into a seed, the seed into a key at a known path. This address is real — it came out of the same derivation the generator runs. Keep the words; share the address.',
    run: async () => {
      for (const branch of branches) {
        branch.material.opacity = 0;
        branch.hexMaterial.opacity = 0;
      }
      bitLabel.material.opacity = 0;
      for (const bit of bits) bit.material.opacity = 0;
      await tween(0.9, (k) => {
        grid.position.y = 1.15 + k * 0.5;
        grid.scale.setScalar(1 - k * 0.42);
        grid.rotation.x = k * 0.28;
      });
      plate.visible = true;
      await fade(plate.material, 1, 0.8);
      await wait(0.4);
    },
  },
];

const ACT_CLOSE: Act = {
  kicker: 'Reminder',
  title: 'Eight valid, none better',
  body: 'Every branch above was a usable phrase. Shorter words are only easier to read. The generator lets you do this with your own 23 words, then seals the key you pick with BIP38 — scrypt and AES over the key itself.',
  run: async () => {
    await wait(0.6);
  },
};
const ALL = [...ACTS, ACT_CLOSE];

// ---------------------------------------------------------------- runner

let actIndex = 0;
let running = false;
let generation = 0;
let frameAccumulator = 0;

function paintActDots(): void {
  actsEl.replaceChildren(
    ...ALL.map((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'act-dot';
      dot.toggleAttribute('data-on', i === actIndex);
      return dot;
    }),
  );
}

async function runAct(index: number): Promise<void> {
  const mine = generation;
  actIndex = index;
  report.act = index;
  paintActDots();
  const act = ALL[index];
  if (!act) return;
  titleEl.textContent = act.title;
  bodyEl.textContent = act.body;
  document.body.dataset.act = String(index);
  await act.run();
  if (mine !== generation) return;
  if (index + 1 < ALL.length) {
    if (instant) {
      window.setTimeout(() => {
        if (mine === generation) void runAct(index + 1);
      }, 0);
      return;
    }
    await wait(1.1);
    if (mine !== generation) return;
    void runAct(index + 1);
  } else {
    running = false;
    playBtn.textContent = 'Replay';
  }
}

function start(): void {
  generation++;
  finishTweens();
  resetScene();
  running = true;
  playBtn.textContent = 'Pause';
  void runAct(0);
}

/** Burn the caption into a still frame so exported images carry their words. */
function drawCaption(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, body: string): void {
  const gradient = ctx.createLinearGradient(0, h - 300, 0, h);
  gradient.addColorStop(0, 'rgba(6,10,13,0)');
  gradient.addColorStop(0.55, 'rgba(6,10,13,0.88)');
  gradient.addColorStop(1, 'rgba(6,10,13,0.98)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, h - 300, w, 300);

  ctx.textAlign = 'left';
  const wrap = (text: string, font: string, maxWidth: number): string[] => {
    ctx.font = font;
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  const margin = 26;
  const width = w - margin * 2;
  const titleLines = wrap(title, '650 25px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', width);
  const bodyLines = wrap(body, '15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', width);

  let y = h - 300 + 28;
  ctx.fillStyle = '#e8eef2';
  ctx.font = '650 25px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  for (const line of titleLines) {
    ctx.fillText(line, margin, y);
    y += 31;
  }
  y += 8;
  ctx.fillStyle = '#93a4b0';
  ctx.font = '15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  for (const line of bodyLines) {
    ctx.fillText(line, margin, y);
    y += 21;
  }
}

/** Synchronous snapshot of the state a chapter starts from, for still frames. */
function applyStateThrough(n: number): void {
  resetScene();
  if (n >= 1) {
    for (let i = 0; i < 23; i++) {
      tiles[i]!.material.opacity = 1;
      tiles[i]!.mesh.position.z = 0;
    }
    slot.material.opacity = 1;
  }
  if (n >= 2) {
    for (const bit of bits) bit.material.opacity = bit.free ? 0.95 : 0.8;
    bitLabel.material.opacity = 0.85;
    slot.material.color.set('#ffffff');
  }
  if (n >= 3) {
    branches.forEach((branch, i) => {
      branch.material.opacity = i === WINNER ? 1 : 0.38;
      branch.hexMaterial.opacity = i === WINNER ? 0.9 : 0.35;
      if (i === WINNER) branch.mesh.scale.setScalar(1.16);
    });
    slot.material.map?.dispose();
    slot.material.map = wordTexture(DETAILS[WINNER]!.word, 23, 'ending');
    slot.material.needsUpdate = true;
  }
  if (n >= 4) {
    for (const branch of branches) {
      branch.material.opacity = 0;
      branch.hexMaterial.opacity = 0;
    }
    bitLabel.material.opacity = 0;
    for (const bit of bits) bit.material.opacity = 0;
    grid.position.y = 1.65;
    grid.scale.setScalar(0.58);
    grid.rotation.x = 0.28;
    plate.visible = true;
    plate.material.opacity = 1;
  }
}

function resetScene(): void {
  for (const tile of tiles) {
    tile.material.opacity = 0;
    tile.mesh.position.z = -1.4;
  }
  slot.material.color.set('#e6fffb');
  for (const bit of bits) {
    bit.material.opacity = 0;
    bit.mesh.position.y = 0;
  }
  bitLabel.material.opacity = 0;
  for (const branch of branches) {
    branch.material.opacity = 0;
    branch.hexMaterial.opacity = 0;
    branch.mesh.scale.setScalar(1);
  }
  plate.visible = false;
  plate.material.opacity = 0;
  grid.position.y = 1.15;
  grid.scale.setScalar(1);
  grid.rotation.x = 0;
}

function nextAct(): void {
  if (!running) {
    start();
    return;
  }
  generation++;
  finishTweens();
  const next = Math.min(ALL.length - 1, actIndex + 1);
  // Fast-forward the visual state to the target act.
  void runAct(next);
}

playBtn.addEventListener('click', () => {
  if (!running) {
    start();
    return;
  }
  paused = !paused;
  playBtn.textContent = paused ? 'Resume' : 'Pause';
  playBtn.setAttribute('aria-pressed', String(paused));
});

stepBtn.addEventListener('click', nextAct);
restartBtn.addEventListener('click', start);

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
  button.addEventListener('click', () => {
    speed = Number(button.dataset.speed);
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
      other.setAttribute('aria-pressed', String(other === button));
    }
  });
}

// ---------------------------------------------------------------- sizing + loop

function fit(forcedW?: number, forcedH?: number): void {
  const width = forcedW ?? (stage.clientWidth || window.innerWidth);
  const height = forcedH ?? (stage.clientHeight || window.innerHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  const needed = 8.6;
  const z = needed / 2 / Math.tan((camera.fov * Math.PI) / 360) / Math.min(1, camera.aspect / 0.62);
  camera.position.z = Math.max(11, z);
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', () => fit());
fit();

const clock = new THREE.Clock();

function loop(): void {
  const dtRaw = clock.getDelta();
  const dt = Math.min(dtRaw, 1 / 20);
  if (!paused) {
    stepTweens(dt);
    particles.rotation.y += dt * 0.012;
    particles.position.y = Math.sin(performance.now() / 4200) * 0.16;
    if (running) frameAccumulator += dt;
  }
  renderer.render(scene, camera);
  report.rendered = true;
  report.triangles = Math.max(report.triangles, renderer.info.render.triangles);
  if (running) report.frames++;
  if (!report.ready) {
    report.ready = true;
    report.resources = performance.getEntriesByType('resource').length;
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

const still = Number(params.get('still'));

if (params.has('still')) {
  // Single-chapter render, used for stills.
  instant = true;
  // Pin the viewport: headless ignores --window-size, so render the exact frame
  // the screenshot will be.
  const VIEW_W = 390;
  const VIEW_H = 844;
  fit(VIEW_W, VIEW_H);
  const at = Math.max(0, Math.min(ALL.length - 1, still));
  report.act = at;
  paintActDots();
  titleEl.textContent = ALL[at]!.title;
  bodyEl.textContent = ALL[at]!.body;
  applyStateThrough(at);
  // Headless will not composite WebGL here and ignores --window-size, so render
  // an exact-size frame through an offscreen target and export it by data URL.
  const w = VIEW_W;
  const h = VIEW_H;
  const pixels = new Uint8Array(w * h * 4);
  const target = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace });
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
  renderer.setRenderTarget(null);
  const flat = document.createElement('canvas');
  flat.width = w;
  flat.height = h;
  const ctx = flat.getContext('2d')!;
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    image.data.set(pixels.subarray(src, src + w * 4), y * w * 4);
  }
  ctx.putImageData(image, 0, 0);
  drawCaption(ctx, w, h, ALL[at]!.title, ALL[at]!.body);
  flat.className = 'still';
  stage.append(flat);
  renderer.domElement.style.visibility = 'hidden';
  const dataUrl = flat.toDataURL('image/png');
  document.body.style.background = `#060a0d url(${dataUrl}) center / cover no-repeat`;
  document.body.dataset.frame = dataUrl;
  document.title = `STILL:${at}`;

} else if (isE2E) {
  speed = 3;
  instant = true;
  document.getElementById('captions')!.setAttribute('data-e2e', '1');
  const publish = (): void => {
    document.title = `EXPLAIN:${JSON.stringify(report)}`;
    if (report.act + 1 < ALL.length) window.setTimeout(publish, 40);
  };
  window.setTimeout(publish, 40);
  start();
} else {
  start();
}