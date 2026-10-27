/** Boot: self-test, then the airgap gate, then the app. */
import './styles.css';

import { go, fatal, render } from './app/router';
import { state, store } from './app/state';
import { runAsyncChecks, runSyncChecks } from './lib/selftest';
import { runE2E } from './e2e';

function appHash(): string {
  const value = document.getElementById('app')?.dataset.apphash ?? '';
  return /^[0-9a-f]{64}$/.test(value) && value !== '0'.repeat(64) ? value : 'unverified';
}

async function boot(): Promise<void> {
  state.hash = appHash();

  const sync = runSyncChecks();
  state.checked = sync.checked;
  if (!sync.ok) {
    state.selfTest = 'fail';
    state.asyncFailures = sync.failures;
    fatal('Self-check failed', sync.failures);
    return;
  }

  state.selfTest = 'ok';
  state.rememberDraft = store.get('local', 'vanity.remember') === 'yes';
  state.airgapAck = state.rememberDraft || store.get('session', 'vanity.airgap') === 'yes';
  state.view = state.airgapAck ? 'build' : 'airgap';
  render();

  const asyncFailures = await runAsyncChecks();
  if (asyncFailures.length > 0) {
    state.selfTest = 'fail';
    state.asyncFailures = asyncFailures;
    render();
    return;
  }

  if (!state.airgapAck) go('airgap');

  const params = new URLSearchParams(location.search);
  if (params.has('e2e')) void runE2E();

  // Debug/preview entry points: ?view=detail&demo=zebra,kite
  if (params.has('demo')) {
    const words = (params.get('demo') || 'zebra,kite').split(',').slice(0, 23);
    words.forEach((w, i) => (state.slots[i] = w.trim()));
    state.fixedLen = words.length;
    const { generateCandidates, chooseCandidate } = await import('./app/flow');
    generateCandidates();
    chooseCandidate(0);
    state.view = (params.get('view') as typeof state.view) || 'results';
    go(state.view);
  } else if (params.has('view')) {
    state.view = params.get('view') as typeof state.view;
    go(state.view);
  }
}

void boot();