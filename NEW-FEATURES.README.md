# OrbitQA Features Guide

## Pods

Pods create persistent browser profiles for desktop, Android and iOS compatibility QA. Each profile stores a stable user agent, viewport, locale, timezone, browser family, proxy assignment and warmer status. Profiles and pod settings return after restarting OrbitQA.

Open **Pods**, choose a device type, country and profile count, then create a pod. Expand a pod to inspect profiles, assign or clear a proxy, remove a profile, or remove the pod. **Warm this pod** opens Warmer with the pod selected. Profile fingerprints are deterministic for the same device, country and profile index.

## Warmer

Warmer runs a browser session for selected profiles using the saved fingerprint and assigned proxy. A profile without an assigned proxy uses a direct connection. Each profile searches one selected topic, visits up to three search results, saves its browser history and updates its warmer status. A failed profile does not prevent the remaining profiles from running. Runs can be stopped from the page.

Add and remove topics in the Topics section. Select a pod and optionally choose a subset of profiles before starting a run. Recent run summaries show status, searches and cookies saved.

The Gmail assignment section stores an email, purpose and optional pod/profile association. It does not perform account login or store credentials.

## Persistence

OrbitQA stores this feature's data locally under Electron's `userData` directory:

- `pods.json` stores pods and profile fingerprints.
- `warmer.json` stores topics and account assignments.
- `pod-history/<profileId>.json` stores visited URLs per profile.
- `pod-browser-profiles/<profileId>/` stores Playwright browser profile state, including browser cookies.

Data is local to the current Windows user profile and is not synced to a cloud service.
