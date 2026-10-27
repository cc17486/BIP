# Audit — 2026-10-27

Scope: the whole repository as built, plus the delivered artifact `dist/vanity-phrase.html`.
Method: manual read of every source file, static scans, new adversarial unit/e2e tests, reproducibility and tamper checks, layout and contrast measurement.

Result: **6 defects found that broke a user-visible feature or produced a wrong value; all fixed and regression-tested.** 71 unit tests and 41 end-to-end assertions pass on two viewport widths, 0 network requests, reproducible bytes.

## Fixed

| # | Severity | Finding | Fix | Regression |
| --- | --- | --- | --- | --- |
| 1 | High | Repair screen appended the chosen ending to the typed words instead of the 23-word base (typed + random filler), yielding a 6-word phrase and a silently dead "choose" button | `base` kept per run; endings chosen against it | e2e `repairWorks` asserts 24 chips on the key screen |
| 2 | High | Search target input re-rendered on every keystroke, so it lost focus after one character on mobile | update only the estimate line while typing | e2e types through the real DOM |
| 3 | High | Verifying an **uncompressed** legacy WIF derived the address from the compressed pubkey, i.e. the wrong address | WIF payload parsed for its compression flag; uncompressed keys use an uncompressed pubkey | unit vectors for both addresses; e2e `wifVerified` |
| 4 | Medium | A second Start tap, or switching address type, could leave two search loops running | `running` guard plus explicit `stop()` of the previous engine | 3× rapid generate/start covered |
| 5 | Medium | Sealing while changing candidate attached the finished `6P` key to the wrong key | derived key identity re-checked after scrypt resolves | exercised by seal → verify pair |
| 6 | Medium | Verify kept the old verdict and old derived address on screen after the inputs changed | inputs invalidate result, derived address and copy button | manual + e2e flow |
| 7 | Medium | "Hide" masked the key screen but not the results screen's phrase strip | results strip honours the mask with its own toggle | e2e `maskWorks` |
| 8 | Low | Scroll position carried between screens; detail opened mid-page | scroll to top on view change | manual |
| 9 | Low | `removeWord` could drive the chosen-word counter negative or splice out of range | bounds checks | unit |
| 10 | Low | Verify index accepted negatives and huge values | clamp to `0…2^31-1` | code |
| 11 | Low | Mask toggle had inverted `aria-pressed` and a static label | pressed = revealed, label switches | code |
| 12 | Low | Dead code: `TITLES`, `titles`, `insertRandom`, `copyText` re-export, `state.notice` | removed | typecheck |
| 13 | Low | Two fast Seal taps ran scrypt twice | busy guard in `seal()` | code |
| 14 | Low | Uncompressed/testnet WIF gave a vague error | explicit "Not a mainnet WIF" and unit test | unit |

## Hardened without a defect

- **Airgap audit** now also fails on `srcset`, `poster`, `formaction`, `data=`, CSS `url()`, CSS `@import`, `<base>`, `<iframe>`, `<form>`, a second script tag, a remote `script src`, an unstamped hash and a weakened CSP. Ten negative fixtures assert each one fails.
- **Hash script** has tamper tests: one flipped character, and a file with the region stripped.
- **Reproducibility**: `npm run verify:repro` builds twice and compares bytes. Two clean builds produce identical SHA-256, so the published hash is meaningful.
- **Stress e2e**: 23-word maximum, 24th-word rejection, entropy at the limit, triple-tap generate, mask, 120-character emoji passphrase through seal → verify, stop-on-navigation, 30-word repair, 24 real words with a bad checksum, clipboard-less copy.
- **Layout**: no horizontal overflow and no control under 40 px at 390 px and 320 px; inputs ≥ 16 px.
- **Contrast**: every text/background pair measured at ≥ 6.1:1 (WCAG AA needs 4.5).
- **QR**: encoded at ECC M for the longest payload emitted (58-byte `6P…`), always dark-on-white.

## Verified properties

- Exactly 8 distinct valid endings for 500 random 23-word prefixes; first 23 words preserved; word 24 never typed.
- BIP38 vectors 1, 2, 3 (including the NFC Unicode passphrase) byte-identical; wrong passphrase rejected by address hash; round trip recovers the key.
- BIP44 / BIP84 / BIP86 vectors; taproot output-key helper equals the tweaked path.
- Filler entropy: 4096 draws spread across all 16 sixteenths of the wordlist.
- Airgap: zero resource requests in a headless `file://` run; CSP `connect-src 'none'`; single inline script.
- Startup self-test: 10 synchronous vectors block the first paint, the BIP38 vector raises its own banner.

## Residual risks (accepted, documented)

1. **No explicit zeroization.** Seeds and keys live in `Uint8Array`s until GC. A browser extension or a later memory snapshot could still see them.
2. **Main-thread search.** Inlined workers do not survive `file://`; slices are capped at 45 ms, so the UI stays usable but not perfectly smooth during long mines.
3. **`localStorage` availability varies** (private mode, some `file://` engines). Only one opt-in flag uses it; storage failures are swallowed.
4. **Taproot + BIP38 is inherently ambiguous** — the format has no address-type field. Mitigated with an on-screen caveat, the address on the card, and a verify screen that derives the output key.
5. **Passphrase whitespace is significant** (NFC-normalised, not trimmed), matching the specs. The field shows a strength hint, not a trimming one.
6. **`?e2e` and `?demo` remain in the production bundle** (~3 KB) and are reachable from the URL.
7. **No camera scanner**; verification is paste-based.
8. The file proves its own integrity against its stamp, but not the cleanliness of the machine that built it.

## Explainer

The three.js walkthrough added in this pass was audited on its own terms:

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 15 | High | `fade()` was passed a material but read `object.material`; the first fade threw and every act after the first never ran | helper takes a material; e2e asserts all six chapters |
| 16 | Medium | Headless Chromium will not composite a WebGL canvas, so still frames were blank or identical | stills render through an offscreen target and export by data URL; `scripts/still.mjs` decodes them |
| 17 | Low | WebGL failure threw before any report existed | report publishes first, fallback panel renders |
| 18 | Low | Lighting made dark tiles nearly invisible on software GL | flat `MeshBasicMaterial` tiles, contrast by design |

The explainer is held to the same rules as the generator: single file, CSP with `connect-src 'none'`, stamped hash, zero resource requests, no worker, zero network.

## Coverage added in this pass

`tests/qr.test.ts`, `tests/scripts.test.ts`, WIF codec tests, filler distribution tests, and 24 new e2e assertions including the airgap gate, repair, clipboard fallback, the 23-word limit, taproot output-key verification, search cancel-on-leave and the explainer chapters.