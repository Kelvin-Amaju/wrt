# OrbitQA Desktop

OrbitQA is a local-first Electron desktop application for browser QA automation. It combines a React and TypeScript interface with Playwright driven runs, proxy and cookie management, device compatibility profiles, and local persistence.

## Development

Install the locked dependencies and start the Vite and Electron development processes:

```sh
npm ci
npm run dev
```

Type-check and create a production renderer build with:

```sh
npm run build
```

Launch the packaged application from the repository with `npm start`. On Windows, `BUILD-ORBITQA-EXE.bat` builds the portable application using `electron-builder.yml`.

## Tests

`npm test` runs the Vitest renderer suite and the Node.js Electron suite. Renderer tests live beside the pages and components under `src/`. Electron tests use Node's built-in `node:test` runner and live beside the main-process modules under `electron/`. Run the Electron suite alone with `npm run test:electron`.

## Local data

Application data is stored under Electron's `userData` directory for the signed-in Windows user. Pod and warmer data, run records, browser profiles, cookies and histories remain on that machine unless the user exports or moves them.

Suggested GitHub repository topics: `electron`, `playwright`, `qa-automation`, `typescript`, `react`, `windows-desktop`.
