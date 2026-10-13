function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function createSessionBudget(durationMs) {
  const duration = Math.max(10000, Number(durationMs) || 60000);
  const finalIntegrityMs = clamp(Math.round(duration * 0.09), 3500, 8000);
  const primaryActionMs = clamp(Math.round(duration * 0.12), 3000, 12000);
  const adObservationMs = clamp(Math.round(duration * 0.05), 800, 6000);
  const followUpMs = clamp(Math.round(duration * 0.08), 1200, 9000);
  const committed = finalIntegrityMs + primaryActionMs + adObservationMs + followUpMs;
  const readingMs = Math.max(0, duration - committed);
  const pace = duration <= 30000 ? 'fast' : duration >= 90000 ? 'slow' : 'natural';
  return { durationMs:duration, finalIntegrityMs, primaryActionMs, adObservationMs, followUpMs, readingMs, pace };
}

module.exports = { createSessionBudget };
