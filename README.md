# Vanity phrase

An airgapped, phone-first generator for **BIP39 phrases you actually like** and the addresses they make, with **BIP38** sealing for the backup.

You pick up to 23 words. The 24th is the BIP39 checksum, so exactly eight words can finish what you typed at any 3-bit branch — the tool finds all eight, derives an address for each, and lets you pick one. That is the whole trick: you are not guessing a checksum, you are enumerating the eight that are valid.

It ships as **one ~200 KB HTML file** that makes no network requests at all.

## What it is not

- Not a wallet. There is no balance lookup, no transaction building, no signing.
- Not a hardware wallet. It is a hot key that happens to be generated on an airgapped screen.
- Not a source of 256-bit entropy when you fix words. Your chosen words are guessable; only the filler is random. The meter says so, in bits, and the address card repeats it.

## Build

```sh
npm install
npm run build          # typecheck, bundle to dist/vanity-phrase.html, stamp hash
npm run verify         # tests, build, airgap audit, hash check, headless offline e2e
```

`npm run verify` is the only command you need before trusting a build. See [VERIFY.md](VERIFY.md).

## Explainer

`dist/explainer.html` is a separate, self-contained three.js walkthrough of the mechanism: 23 tiles, the 3 free bits, the eight branches with their real SHA-256 bytes, and the address that comes out. Every number in it is computed by the same code as the generator. It is 660 KB because three.js is bundled, it also makes zero requests, and it is not needed to generate keys.

## Deploy to the phone

1. Build on the online machine.
2. Copy `dist/vanity-phrase.html` (and `dist/BUILD-INFO.txt`) over USB into the phone's Downloads.
3. Optionally copy `dist/explainer.html` too, for the walkthrough.
4. On the phone: airplane mode on, Wi-Fi/Bluetooth/hotspot off.
5. Open the file from the Files app. It runs straight from `file://`.
6. Compare the hash shown in the app against `BUILD-INFO.txt`. Then tap through the airgap checklist.

iOS Safari will open it from Files but will not let you "download" anything from `file://`; use the copy buttons and the print sheet instead.

## Using it

1. **Airgap check** — confirm the hash, then continue.
2. **Build** — type words with autocomplete (only the 2048 BIP39 words count), or press the die for random ones. Words you type are placed first; the rest are random. Pick an address type.
3. **Eight valid endings** — pick one.
4. **Key screen** — the phrase, the address, the WIF, and a BIP38 passphrase box. Seal the key, print the card, then clear the screen.
5. **Verify** — paste the phrase or the sealed key back in and let it recompute. Do this before you send coins.

Extra screens:

- **Recreate endings** — paste 1–23 words you already have (or 24 to check them) and get the valid endings. Useful for a half-remembered wallet or a mistyped last word.
- **Search an address** — the phrase stays put and the tool scans address indexes (and optionally fresh filler) for a target prefix, suffix or substring. Realistically 3–4 characters on a phone.

### Entropy, honestly

| Words you fix | Entropy left |
| --- | --- |
| 0 | 256 bits |
| 12 | 124 bits |
| 15 | 91 bits |
| 20 | 36 bits |
| 23 | 3 bits (guessable) |

Below 64 bits, add a BIP38 passphrase or shorten the phrase. Below 128 bits, do not put a life-changing balance on it.

## BIP38 notes

Non-EC-multiplied BIP38 only (`0x0142`), compressed keys. scrypt N=16384 takes a few seconds on a phone; the field shows a progress state and the app keeps painting.

**Taproot caveat:** BIP38 has no field recording the address type. A sealed taproot key will look like a wrong passphrase to a generic importer, because it derives a segwit address to check against. Sweep using the address shown on the card. The key presented for sealing is the internal HD key; the tweaked output-key WIF is shown separately for sweep tools that want it.

Losing the BIP38 passphrase is the same as losing the coins. There is no recovery.

## Layout

```
index.html              shell + CSP
src/main.ts             boot, self-test gate
explainer/              three.js walkthrough (its own build, dist/explainer.html)
src/app/                state, router, screens (airgap/build/results/detail/search/verify/repair)
src/lib/                words, mnemonic, derive, bip38, qr, search, selftest
src/styles.css          mobile-first, dark, print sheet
tests/                  vitest: vectors, properties, round trips
scripts/                finalize, hash check, airgap audit, offline e2e, still frames
```

## Known limits

- 24-word phrases only; English wordlist only.
- The vanity search is a single-threaded, time-sliced loop. A file:// origin kills inlined workers, so be it.
- No camera scanner; verify by paste.
- The explainer needs WebGL; the generator does not.
- Address index is part of the backup. Write it down with the key if it is not 0.
- `localStorage` holds one "skip the checklist" flag, opt-in, and nothing else.

## Licence

MIT. Dependencies: `@noble/*`, `@scure/*` (MIT), `uqr` (MIT).