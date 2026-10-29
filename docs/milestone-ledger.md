# Hex Shift milestone ledger

States are **implemented** (code and automated tests in the branch), **verified** (release gates for that commit, including manual evidence that was actually run), and **released** (the GitHub release is published and the published bytes were checked). A missing check stays missing. It is not a pass.

The Windows report of an unexpected Advanced state was not reproduced against the published 3.10.0 executable. The guest copy at `C:\HexShift\HexShift.exe` is a local build. Shipping the slider-sync guard does not turn that report into a reproduced pass.

## 3.11.0 — Reliable picking and visible failures

- Scope: separate fine-slider synchronization from edits; name the Advanced reasons and route to the affected colour; pick within 6 CSS pixels (mouse/pen) or 10 (touch) at the pointer-down image pixel, and pan once past that; keep Pan, Space-drag and brush; never pick on cancel, lost capture or pinch; persistent filename-and-reason import notice. A pasted image always opens as `pasted.png`.
- State: **implemented**. Not verified. Not released.
- Commit: the `grok/v3-11` change that carries this file. The release commit is the annotated tag `v3.11.0` after the squash, which does not exist yet.
- Tests, 29 October 2026, this machine, Node v24.20.0:
  - `npm test`: 107 passed, 0 failed.
  - `npm audit --audit-level=low`: 0 vulnerabilities.
  - `npm ci --ignore-scripts` had already completed with 0 vulnerabilities.
  - Playwright, `HEXSHIFT_PORT=4183`, 3 workers, Chromium, Firefox and WebKit: 325 passed, 8 skipped, 3 failed. The skips are the existing Firefox and WebKit skips for touch emulation, the offline shell, fallback pixel buffers, and the 3.1.1 outline byte comparison. The 3 failures were the same paste test: a clipboard file named `paste.png` kept that name, and the test expects `pasted.png`. The handler now names every pasted image `pasted.png`. That test was rebuilt and rerun on all three browsers: 3 passed. The other 325 were not rerun after that one-line change.
  - `tests/browser/reliability.spec.js` passed on all three browsers inside that suite, including Simple staying Simple, every named Advanced reason, tab switching and undo, pick thresholds, cancellation, pinch, and the import notice at a narrow width and at 200% page zoom.
- Manual evidence: `docs/manual-tests.md` is not in this repository, and that checklist was not run by hand. The published Windows 3.10.0 executable was not exercised. The unexpected Advanced report stays unreproduced. `HostTests.exe verify-release` was not run, so this is not `RELEASE CHECK PASSED`. A disposable Windows install without WebView2 was not tested.
- Blockers: none in the editor code. Publication still needs the checks and windows-app jobs, the tag, and approval of the protected `release` environment.
- Artifact hashes: none. Local portable shell after the paste fix: `6b69a9bf44ad0daf`.
- Release URL: none.

## 3.12.0 — Finishable polygons and truthful recipe warnings

- State: not started.

## 3.13.0 — Explicit, bounded import downscaling

- State: not started.

## Animation prototype

- State: not started. It does not block 3.11.0, 3.12.0 or 3.13.0, and it does not add animation to those releases.
