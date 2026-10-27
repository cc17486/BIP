# Verifying a build

This is a key generator. Before you put coins on anything it produces, you should be able to satisfy yourself that the file on your phone is the file this repository builds.

Everything below is doable offline with the delivered files.

## 1. Hash check

`dist/BUILD-INFO.txt` carries the SHA-256 of `dist/vanity-phrase.html`, computed with the 64-character hash region zeroed (the page cannot contain its own digest). The same value is embedded in the page and shown on the airgap screen.

```sh
node scripts/check-hash.mjs dist/vanity-phrase.html
```

Exit code 0 and an `ok <hash>` line mean the file matches its stamp. The app refuses to claim a hash it cannot read: if the region is still zeroed it shows `unverified`.

## 2. Self-test

On load the page runs ten derivation vectors before it renders anything:

- SHA-256 and RIPEMD-160 of `abc`
- Base58Check round trip
- The English wordlist fingerprint
- The eight-ending property on an all-`abandon` prefix
- BIP32 depth, then the BIP44, BIP84 and BIP86 first-address vectors
- A live `crypto.getRandomValues` draw

Then the BIP38 specification vector runs in the background (scrypt is slow).

The top bar shows the number of vectors that passed. Any disagreement replaces the seal with `FAIL`, raises a red banner and is itself a reason not to use the build.

## 3. Airgap audit

```sh
npm run audit
```

Fails on: a remote `src`/`href`, any `http(s)://` URL other than the SVG namespace, a missing or weakened Content-Security-Policy, a second script tag, a dynamic remote import, an unstamped hash, or a bundle over 500 KB.

The policy is:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data:; connect-src 'none'; worker-src blob: data:;
base-uri 'none'; form-action 'none'
```

`connect-src 'none'` is the important one: even if something tried to phone home, the browser would not let it.

## 4. Zero requests, headless

```sh
npm run e2e
```

Loads the built file over `file://` in headless Chromium with no server and asserts `performance.getEntriesByType('resource').length === 0`. It then drives the real DOM: autocomplete, chip, generate, eight endings, detail with QRs, BIP38 seal, verify. It also fails on horizontal overflow at 390 px, on any control shorter than 40 px, or on an input with a font under 16 px (iOS zoom).

## 4b. Explainer

`dist/explainer.html` has its own hash file and the same audit. `npm run verify` runs the same headless check against it: WebGL up, frames drawn, all six chapters reached, captions advancing, no page errors, zero requests.

```sh
node scripts/check-hash.mjs dist/explainer.html
node scripts/e2e-explainer.mjs
```

## 5. In the browser

Open the page with the device online, devtools open, Network tab clear:

1. Reload. The only entry should be the document itself.
2. Console: no CSP violations.
3. Application → Session storage: at most one `vanity.airgap` flag. Local storage: only an opt-in `vanity.remember`.

## 6. Restore drill

Do this with an empty wallet before trusting the card:

1. Generate a phrase, seal it with a passphrase, print the card.
2. Clear the screen, power off, power on.
3. Verify screen → paste the 24 words → the derived address must match the printed one.
4. Verify screen → paste the `6P…` key and the passphrase → the address must match again.
5. Import the sealed key into a real wallet and check the address matches before sweeping.

Step 5 is the one that catches taproot import quirks. BIP38 has no address-type field, so a generic importer may report a wrong passphrase for a taproot key: compare the address, not just the error text.

## 7. Reading the crypto

`src/lib/bip38.ts` is short and follows BIP38 to the letter: `0x0142`, address hash, scrypt(16384, 8, 8), AES-256-ECB, Base58Check. It reproduces the specification's vectors, including the Unicode NFC one, in `tests/bip38.test.ts`.

`src/lib/mnemonic.ts` never chooses a checksum by guessing: for each of the eight 3-bit values it computes SHA-256 of the full entropy and keeps the word that matches.

## What a build cannot prove

- That the machine that built it was clean.
- That your phone's browser is unmodified.
- That you kept the phrase off a camera.

It can prove the file in your hand matches this source and that the crypto in it agrees with published vectors. That is the useful part.