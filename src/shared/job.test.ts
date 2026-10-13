import { describe, expect, it } from 'vitest';
import { createDraftJob, summarizeJobs } from './job';

describe('job domain', () => {
  it('creates a draft job with lightweight defaults', () => {
    const job = createDraftJob('https://example.com');
    expect(job.targetUrl).toBe('https://example.com');
    expect(job.concurrency).toBe(3);
    expect(job.status).toBe('draft');
  });

  it('summarizes job states for dashboard metrics', () => {
    const draft = createDraftJob('https://a.test');
    const running = { ...createDraftJob('https://b.test'), status: 'running' as const };
    const completed = { ...createDraftJob('https://c.test'), status: 'completed' as const };
    expect(summarizeJobs([draft, running, completed])).toEqual({
      total: 3,
      running: 1,
      completed: 1,
      failed: 0,
    });
  });
});
