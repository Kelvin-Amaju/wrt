import { describe, expect, it } from 'vitest';
import { isTerminalRunStatus, normalizeRunExecutionMode } from './runCenter';

describe('run center domain', () => {
  it('treats only completed, failed, and stopped as terminal', () => {
    expect(isTerminalRunStatus('RUNNING')).toBe(false);
    expect(isTerminalRunStatus('PAUSED')).toBe(false);
    expect(isTerminalRunStatus('COMPLETED')).toBe(true);
    expect(isTerminalRunStatus('FAILED')).toBe(true);
    expect(isTerminalRunStatus('STOPPED')).toBe(true);
  });

  it('defaults execution mode to visible', () => {
    expect(normalizeRunExecutionMode(undefined)).toBe('visible');
    expect(normalizeRunExecutionMode('background')).toBe('background');
  });
});
