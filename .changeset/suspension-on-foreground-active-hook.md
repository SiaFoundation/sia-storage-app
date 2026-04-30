---
core: minor
---

Add `onForegroundActive` optional hook to `createSuspensionManager`. Fires synchronously on every `setAppState('foreground')` call, including no-op calls — covers the case where the manager is already resumed (e.g. by a BG task) and the user subsequently foregrounds, where `onAfterResume` does not fire.
