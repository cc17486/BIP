/** Shared generation/selection flow so the UI and the e2e harness drive the same code. */
import { accountNode, addressOf, addressPath, deriveAt, seedFor } from '../lib/derive';
import { endingCandidates } from '../lib/mnemonic';
import type { Candidate } from './state';
import { fillRest, state } from './state';

/** A sealed key belongs to one candidate only. */
function resetExport(): void {
  state.exportState.code = null;
  state.exportState.error = null;
  state.exportState.busy = false;
}

/** Fill empty slots, compute the 8 endings and their addresses. */
export function generateCandidates(): Candidate[] {
  fillRest();
  const prefix = state.slots.slice(0, 23) as string[];
  const candidates = endingCandidates(prefix).map((ending) => {
    const account = accountNode(seedFor([...prefix, ending], state.passphrase), state.addressType);
    return {
      ending,
      address: addressOf(account.deriveChild(0), state.addressType),
      path: addressPath(state.addressType, 0),
      index: 0,
    };
  });
  state.candidates = candidates;
  state.selected = null;
  state.derived = null;
  state.phrase = [];
  return candidates;
}

/** Turn a candidate into the current key. */
export function chooseCandidate(index: number): void {
  resetExport();
  const candidate = state.candidates[index];
  if (!candidate) throw new Error(`no candidate ${index}`);
  const prefix = state.slots.slice(0, 23) as string[];
  const words = [...prefix, candidate.ending];
  state.selected = index;
  state.phrase = words;
  const account = accountNode(seedFor(words, state.passphrase), state.addressType);
  state.derived = deriveAt(account, state.addressType, candidate.index);
}

/** Adopt an arbitrary phrase (search hit, repair result) as the current key. */
export function chooseWords(words: string[], index: number): void {
  resetExport();
  state.phrase = words;
  state.slots = [...words.slice(0, 23), null];
  state.selected = null;
  const account = accountNode(seedFor(words, state.passphrase), state.addressType);
  state.derived = deriveAt(account, state.addressType, index);
}