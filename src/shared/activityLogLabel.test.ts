import { describe, expect, it } from 'vitest';
import { activityWorkLabel } from './activityLogLabel';

describe('activityWorkLabel', () => {
  it('distinguishes simultaneous work units that share the same target and group prefix', () => {
    const first = activityWorkLabel({
      workId: 'target-mu3rsggj-8-group-mu3rsggj-9-instance-1',
      targetId: 'target-mu3rsggj-8',
      groupId: 'group-mu3rsggj-9',
      instanceIndex: 0,
    });
    const second = activityWorkLabel({
      workId: 'target-mu3rsggj-8-group-mu3rsggj-9-instance-2',
      targetId: 'target-mu3rsggj-8',
      groupId: 'group-mu3rsggj-9',
      instanceIndex: 1,
    });

    expect(first).toBe('T8/G9 #1');
    expect(second).toBe('T8/G9 #2');
    expect(first).not.toBe(second);
  });

  it('labels run-level events as RUN', () => {
    expect(activityWorkLabel({})).toBe('RUN');
  });
});
