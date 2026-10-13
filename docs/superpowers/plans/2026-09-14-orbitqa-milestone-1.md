# OrbitQA Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable Windows Electron application shell with secure Electron boundaries, original dark control-panel UI, navigation, dashboard metrics, and a lightweight job-state model.

**Architecture:** Electron owns the native window and preload bridge; React owns the renderer. A small framework-agnostic domain module models jobs and dashboard metrics so it can be tested without Electron. Browser automation, SQLite, proxies, and scheduling are deliberately deferred to later milestones.

**Tech Stack:** Electron, React, TypeScript, Vite, Vitest, Testing Library, plain CSS.

**Spec:** `docs/superpowers/specs/2026-09-14-orbitqa-v1-design.md`

## Global Constraints
- Windows-only V1.
- Local-first with no login or cloud dependency.
- Idle app launches no Playwright browser processes.
- Default concurrency is 3; recommended maximum is 5.
- Renderer uses `contextIsolation=true` and `nodeIntegration=false`.
- No heavyweight UI framework.
- Website automation scope is authorized QA/testing only.

---

### Task 1: Project foundation and job-state domain

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src/shared/job.ts`
- Create: `src/shared/job.test.ts`

**Interfaces:**
- Produces: `JobStatus`, `QaJob`, `createDraftJob()`, `summarizeJobs()`.

- [ ] **Step 1: Write the failing domain tests**

```ts
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
    expect(summarizeJobs([draft, running, completed])).toEqual({ total: 3, running: 1, completed: 1, failed: 0 });
  });
});
```

- [ ] **Step 2: Run `npm test -- src/shared/job.test.ts` and verify RED**
Expected: failure because `./job` does not yet exist.

- [ ] **Step 3: Implement the minimal domain module**

```ts
export type JobStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed';

export interface QaJob {
  id: string;
  targetUrl: string;
  concurrency: number;
  status: JobStatus;
}

export function createDraftJob(targetUrl: string): QaJob {
  return { id: crypto.randomUUID(), targetUrl, concurrency: 3, status: 'draft' };
}

export function summarizeJobs(jobs: QaJob[]) {
  return {
    total: jobs.length,
    running: jobs.filter((job) => job.status === 'running').length,
    completed: jobs.filter((job) => job.status === 'completed').length,
    failed: jobs.filter((job) => job.status === 'failed').length,
  };
}
```

- [ ] **Step 4: Re-run the test and verify GREEN**
Expected: 2 passing tests.

- [ ] **Step 5: Commit**
`git add . && git commit -m "feat: add OrbitQA project foundation"`

### Task 2: Secure Electron shell

**Files:**
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `src/shared/desktop-api.ts`
- Create: `src/shared/desktop-api.test.ts`

**Interfaces:**
- Produces: `DesktopApi` with `getAppInfo(): Promise<{ name: string; version: string }>`.

- [ ] **Step 1:** Write a failing test for the typed app-info contract.
- [ ] **Step 2:** Run the targeted test and verify RED.
- [ ] **Step 3:** Implement the shared contract, preload bridge, and BrowserWindow with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- [ ] **Step 4:** Run tests and verify GREEN.
- [ ] **Step 5:** Commit `feat: add secure Electron shell`.

### Task 3: React renderer and navigation shell

**Files:**
- Create: `index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/App.test.tsx`
- Create: `src/renderer/components/Sidebar.tsx`
- Create: `src/renderer/components/Topbar.tsx`
- Create: `src/renderer/styles.css`

**Interfaces:**
- Produces: navigation keys `dashboard`, `tests`, `proxies`, `profiles`, `scripts`, `scheduler`, `reports`, `system`, `settings`.

- [ ] **Step 1:** Write a failing renderer test proving Dashboard renders and clicking Proxy Manager changes the page heading.
- [ ] **Step 2:** Run it and verify RED.
- [ ] **Step 3:** Implement the shell using React state and plain CSS.
- [ ] **Step 4:** Run tests and verify GREEN.
- [ ] **Step 5:** Commit `feat: add OrbitQA navigation shell`.

### Task 4: Dashboard milestone

**Files:**
- Create: `src/renderer/pages/Dashboard.tsx`
- Create: `src/renderer/pages/Dashboard.test.tsx`
- Create: `src/renderer/components/MetricCard.tsx`
- Create: `src/renderer/components/StatusPanel.tsx`
- Create: `src/renderer/components/ActivityFeed.tsx`

**Interfaces:**
- Consumes: dashboard summary shape from `summarizeJobs()`.
- Produces: dashboard UI with total jobs, running jobs, completed jobs, failed jobs, engine status, and sample local activity entries.

- [ ] **Step 1:** Write failing tests for metric rendering and system-status labels.
- [ ] **Step 2:** Run and verify RED.
- [ ] **Step 3:** Implement minimal dashboard components.
- [ ] **Step 4:** Run all tests and `npm run build`; verify GREEN.
- [ ] **Step 5:** Commit `feat: add OrbitQA dashboard`.

### Task 5: Developer run scripts and beginner handoff

**Files:**
- Modify: `package.json`
- Create: `README.md`

**Interfaces:**
- Produces commands `npm run dev`, `npm test`, and `npm run build`.

- [ ] **Step 1:** Add a smoke test for package scripts that checks required script names from `package.json`.
- [ ] **Step 2:** Run and verify RED if scripts are absent.
- [ ] **Step 3:** Add development/build scripts and concise Windows beginner instructions.
- [ ] **Step 4:** Run `npm test` and `npm run build`; verify GREEN.
- [ ] **Step 5:** Commit `docs: add beginner setup and run guide`.
