---
core: minor
---

Add isAbortError(e) and getErrorMessage(e) helpers at @siastorage/core/lib/errors for consistent handling of abort signals (DOMException and Error name='AbortError' variants) and error-message extraction across packages.
