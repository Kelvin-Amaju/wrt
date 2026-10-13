const TERMINAL_TYPES = new Set(['run-complete', 'run-cancelled', 'run-error']);

function createRunEventGate(send) {
  let terminalEvent = null;
  return {
    emit(payload) {
      if (TERMINAL_TYPES.has(payload?.type)) {
        terminalEvent = payload;
        return;
      }
      send(payload);
    },
    flush() {
      if (!terminalEvent) return;
      const payload = terminalEvent;
      terminalEvent = null;
      send(payload);
    },
  };
}

module.exports = { createRunEventGate, TERMINAL_TYPES };
