export type JobStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed';

export interface QaJob {
  id: string;
  targetUrl: string;
  concurrency: number;
  status: JobStatus;
}

export interface JobSummary {
  total: number;
  running: number;
  completed: number;
  failed: number;
}

export function createDraftJob(targetUrl: string): QaJob {
  return {
    id: crypto.randomUUID(),
    targetUrl,
    concurrency: 3,
    status: 'draft',
  };
}

export function summarizeJobs(jobs: QaJob[]): JobSummary {
  return {
    total: jobs.length,
    running: jobs.filter((job) => job.status === 'running').length,
    completed: jobs.filter((job) => job.status === 'completed').length,
    failed: jobs.filter((job) => job.status === 'failed').length,
  };
}
