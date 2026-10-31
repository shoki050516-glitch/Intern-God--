export function createGameLoading(options = {}) {
  const root = options.root || document.querySelector('[data-hm-loading]');
  const progress = options.progress || root?.querySelector('progress');
  const status = options.status || root?.querySelector('[data-hm-loading-status]');
  const button = options.startButton || document.querySelector('#hm-game-start,[data-hm-action="start-game"]');
  const labels = options.labels || {};
  let state = { phase: 'idle', stage: '', completed: 0, total: 0, failed: 0 };
  let pending = null;
  function publish() {
    if (button) button.disabled = state.phase !== 'ready';
    if (root) { root.hidden = state.phase === 'ready'; root.dataset.phase = state.phase; }
    if (progress) {
      progress.max = Math.max(1, state.total);
      if (state.total > 0 && state.completed < state.total) progress.value = state.completed;
      else progress.removeAttribute('value');
    }
    if (status) status.textContent = state.phase === 'failed' ? (labels.failed || 'Loading failed') :
      state.stage || (state.completed < state.total ? (labels.loading || 'Loading') : (labels.preparing || 'Preparing scene'));
    try { Promise.resolve(options.onChange?.({ ...state })).catch(() => {}); } catch {}
  }
  publish();
  return {
    get state() { return { ...state }; },
    run(prepare) {
      if (pending) return pending;
      if (state.phase === 'ready') return Promise.resolve();
      state = { phase: 'loading', stage: '', completed: 0, total: 0, failed: 0 };
      publish();
      pending = Promise.resolve().then(() => prepare({
        report(value) {
          state.total = Math.max(0, Number(value.total) || 0);
          state.completed = Math.min(state.total, Math.max(0, Number(value.completed) || 0));
          state.failed = Math.min(state.completed, Math.max(0, Number(value.failed) || 0));
          publish();
        },
        setStage(label) { state.stage = String(label || ''); publish(); }
      })).then((result) => {
        state.phase = 'ready'; publish(); return result;
      }, (error) => {
        state.phase = 'failed'; publish(); throw error;
      }).finally(() => { pending = null; });
      return pending;
    }
  };
}
