# OrbitQA Desktop V1 Design

## Product direction
OrbitQA is a Windows-only, local-first desktop QA automation control panel inspired by the reference screenshots but visually redesigned to be cleaner and original. Version 1 focuses on authorized website QA/testing rather than artificial traffic or platform manipulation.

## User experience
The app uses a dark desktop control-panel shell with a fixed sidebar and top status bar. Primary sections are Dashboard, Test Runs, Proxy Manager, Device Profiles, Scripts, Scheduler, Reports, System Monitor, and Settings. The initial milestone delivers the shell, navigation, dashboard, and a lightweight local job model; later milestones add real browser execution and persistence.

## Technology
- Electron for the Windows desktop shell.
- React + TypeScript + Vite for the renderer.
- Plain CSS variables and lightweight components; no heavy UI framework.
- Vitest + Testing Library for renderer and domain tests.
- Playwright for Chromium, Firefox, and WebKit QA sessions.
- SQLite for structured local persistence once the core shell is stable.
- electron-builder for the Windows installer in a later milestone.

## Lightweight constraints
- Idle app launches no Playwright browser processes.
- Browser engines start only when a QA job runs.
- Default concurrency is 3 and recommended maximum is 5; extra sessions queue.
- A browser process may be reused with isolated contexts within a job where safe.
- No always-on backend service, Docker, or cloud dependency.
- Avoid heavyweight UI libraries and Monaco; advanced script editing begins with a lightweight text editor.

## Security boundaries
Electron renderer uses contextIsolation=true, nodeIntegration=false, and a narrow preload bridge. Website automation is designed for sites the user owns or is authorized to test. The app does not implement fake ad clicks, artificial engagement, streaming manipulation, referrer fraud, or anti-detection fingerprint spoofing.

## Core pages
### Dashboard
Shows app status, recent QA runs, success/failure counts, average duration, queued/running jobs, and an activity feed.

### Test Runs
Creates QA jobs from a target URL, browser engine, device profile, concurrency, session count, and a selected behavior script.

### Proxy Manager
Stores optional HTTP/SOCKS proxy endpoints, validates connectivity, and assigns pools to authorized QA jobs.

### Device Profiles
Stores desktop/mobile viewport, user-agent, locale, timezone, and browser-engine presets for compatibility testing.

### Scripts
Provides a visual step builder plus an advanced text mode for the same controlled action model. Initial actions: open URL, wait for selector, click, fill, scroll, screenshot, assert text, and close.

### Scheduler
Runs saved QA jobs later or on a recurrence while the desktop app is running.

### Reports
Shows saved run summaries, errors, timings, screenshots, and exportable results.

### System Monitor
Shows app CPU/memory summary, queue depth, active browser processes, and engine state.

### Settings
Stores local preferences, paths, default concurrency, screenshot behavior, and browser visibility.

## Architecture
### Electron main process
Owns lifecycle, native window creation, filesystem access, database access, scheduler, browser engine, proxy checks, and job execution.

### Preload bridge
Exposes typed, allow-listed IPC methods to the renderer. The renderer never receives unrestricted Node.js access.

### React renderer
Owns navigation, forms, dashboards, visual script editing, and presentation. It calls the preload API for state and actions.

### Job engine
A bounded queue controls QA session concurrency. Jobs contain multiple sessions. Excess sessions wait instead of starting extra browsers.

### Browser engine
Playwright adapters expose one interface for Chromium, Firefox, and WebKit. Each session executes the same controlled script action model and returns a typed result.

### Persistence
SQLite stores jobs, runs, scripts, proxies, profiles, schedules, reports, settings, and activity events. Persistence is introduced after the shell and domain model tests are stable.

## Initial milestone
Build a runnable Windows Electron application with the original dark UI shell, working navigation, dashboard cards, lightweight job-state model, safe preload bridge, and tests. Browser execution, SQLite, and remaining pages follow as separate milestones to keep the first build understandable and testable.
