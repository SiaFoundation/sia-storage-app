---
core: minor
---

createSuspensionManager owns BG-task lifecycle via setAppState, registerBackgroundTask, releaseBackgroundTask, and getRunningBackgroundTaskIds; background work uses a native AbortController so signal.aborted cancels the poll loop at any await boundary.
