# Hex Shift 2

A focused update for recolouring emoji and transparent assets: a canvas-first responsive workspace, magnified picking, image palette, selection brushes, comparison views, redo, exact-colour and transparency modes, and lossless PNG/WebP export.

Images stay local. The update adds bounded input validation, guarded static SVG import, a restrictive content security policy, cancellable worker processing, scoped offline caches, and tighter Windows-host boundaries. Review docs/security-review.md in the source repository for verification evidence and remaining limitations.

**New in 2.1.0 (Windows):** Hex Shift can check for updates. At most once a day it asks the project's update address, and if a newer version exists it shows a notice with release notes, **Download update** and **Later**. Nothing is downloaded without a click, and nothing is installed without a second confirmation that reminds you to export your image first. Every update is verified with a cryptographic signature before it can run. Turn the automatic check off, or check by hand, from the window's system menu (right-click the title bar). There is now also a per-user installer, `HexShift-2.1.0-Setup.exe`; the portable program offers it instead of replacing itself. Copies of 2.0 have no updater, so install 2.1.0 once by hand. See docs/updates.md for how it works and how releases are signed.

**Windows:** HexShift.exe is portable and currently unsigned. Verify its SHA-256 against SHA256SUMS.txt and its GitHub build provenance before use. A checksum hosted alongside a binary does not independently protect against a compromised publisher account. Do not routinely bypass operating-system warnings. No code-signing identity has been provisioned.

HexShift.html opens locally in a current browser. HexShift.zip includes the executable, HTML, documentation and licence notices.
