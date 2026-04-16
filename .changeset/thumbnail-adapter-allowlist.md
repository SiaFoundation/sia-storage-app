---
core: patch
---

The thumbnail scanner now consults a `thumbnailableTypes` allowlist declared by each adapter, skipping formats the platform can't decode (proprietary RAW, JPEG XL, PSD, SVG, HEIC sequence, TIFF on mobile) instead of retrying on every cold start.
