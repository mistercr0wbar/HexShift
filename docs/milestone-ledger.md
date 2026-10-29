# Hex Shift milestone ledger

States are **implemented** (code and automated tests in the branch), **verified** (release gates for that commit, including manual evidence that was actually run), and **released** (the GitHub release is published and the published bytes were checked). A missing check stays missing. It is not a pass.

The Windows report of an unexpected Advanced state was not reproduced against the published 3.10.0 executable. The guest copy at `C:\HexShift\HexShift.exe` is a local build. Shipping the slider-sync guard does not turn that report into a reproduced pass.

## 3.11.0 — Reliable picking and visible failures

- Scope: separate fine-slider synchronization from edits; name the Advanced reasons and route to the affected colour; pick within 6 CSS pixels (mouse/pen) or 10 (touch) at the pointer-down image pixel, and pan once past that; keep Pan, Space-drag and brush; never pick on cancel, lost capture or pinch; persistent filename-and-reason import notice. A pasted image always opens as `pasted.png`.
- State: **implemented** and **released**. Not verified. The manual checklist was not run, so the missing checks stay missing.
- Commit: `e7a43e62b027782532fd331146945ed4ec51aae0` on `main` (squash of `grok/v3-11` `b9c96504691a1f235aded178f9b10ef316a9ae2e`). Annotated tag `v3.11.0` points at that commit. The trees match.
- Tests, 29 October 2026, this machine, Node v24.20.0:
  - `npm test`: 107 passed, 0 failed.
  - `npm audit --audit-level=low`: 0 vulnerabilities.
  - `npm ci --ignore-scripts` had already completed with 0 vulnerabilities.
  - Playwright, `HEXSHIFT_PORT=4183`, 3 workers, Chromium, Firefox and WebKit: 325 passed, 8 skipped, 3 failed. The skips are the existing Firefox and WebKit skips for touch emulation, the offline shell, fallback pixel buffers, and the 3.1.1 outline byte comparison. The 3 failures were the same paste test: a clipboard file named `paste.png` kept that name, and the test expects `pasted.png`. The handler now names every pasted image `pasted.png`. That test was rebuilt and rerun on all three browsers: 3 passed. The other 325 were not rerun after that one-line change.
  - `tests/browser/reliability.spec.js` passed on all three browsers inside that suite, including Simple staying Simple, every named Advanced reason, tab switching and undo, pick thresholds, cancellation, pinch, and the import notice at a narrow width and at 200% page zoom.
- Manual evidence: `docs/manual-tests.md` is not in this repository, and that checklist was not run by hand. The published Windows 3.10.0 executable was not exercised. The unexpected Advanced report stays unreproduced. `HostTests.exe verify-release` was not run, so this is not `RELEASE CHECK PASSED`. A disposable Windows install without WebView2 was not tested.
- Blockers: none for publication. Manual evidence is still absent, and that absence is not a pass.
- Release checks, 29 October 2026: tag workflow https://github.com/mistercr0wbar/HexShift/actions/runs/40930239559 completed success. `checks` and `windows-app` succeeded. In the `release` job, `HostTests.exe verify-release` printed `RELEASE CHECK PASSED` against the exact executable, installer, feed, signature, public key, and tag before the draft was created. The job then published the draft.
- Artifact hashes: the seven published assets match `SHA256SUMS.txt` (checked by downloading the release). `appcast.json` offers 3.11.0 and the installer URL `https://github.com/mistercr0wbar/HexShift/releases/download/v3.11.0/HexShift-3.11.0-Setup.exe` at 2,585,531 bytes. `https://thecr0wbar.xyz/updates/hexshift/appcast.json` and `.signature` byte-match the release, and so do `https://github.com/mistercr0wbar/HexShift/releases/latest/download/appcast.json` and `.signature`. Local portable shell for the 3.11 commit: `6b69a9bf44ad0daf`.
- Release URL: https://github.com/mistercr0wbar/HexShift/releases/tag/v3.11.0 (published 2026-10-29T18:35:51Z, not a draft).
- Not checked: `docs/manual-tests.md` is not in the repository and was not run by hand. No disposable Windows install without WebView2. No live upgrade from an installed 3.10.0. The unexpected Advanced report stays unreproduced. `https://mistercr0wbar.github.io/HexShift/` does not serve this release: the page has no 3.11.0 text, `HexShift.html` there returns 404, and its `sw.js` is not the file on `main`. The Pages builds list is empty. That hosting gap is separate from the GitHub release.

## 3.12.0 — Finishable polygons and truthful recipe warnings

- Scope: a polygon stays Advanced-only on the active colour and does not choose that colour. The draft draws the last-vertex-to-pointer edge and highlights a close target. Close is within 8 CSS pixels (mouse/pen) or 12 (touch) of the displayed first vertex, after three vertices, including a click that starts just outside the bitmap. Enter, Backspace and Escape stay. Escape drops only the draft. A draft is not history; closing is one entry. Draft and pointer state clear on document, row, tool and cancel, and a late release from the previous gesture does nothing. One omission summary covers Save recipe, selected tabs, all tabs, Files to ZIP, and applying an imported recipe. Export all tabs renders pixels and does not warn. Named reasons (brush, connected, polygon) survive baking, history, sessions and recipe files. Recipes still contain no coordinates or masks. Known omissions, an explicit empty list, an old approximation flag, and a legacy file with no field stay distinct. Continue/Cancel is one dialog. Cancel changes nothing. A stale revision is not applied. An imported recipe keeps the target's already rendered spatial edits and warns about the recipe. Applying only to the source tab bakes once and does not warn.
- State: **implemented**. Not verified. Not released.
- Commit: the `grok/v3-12` change that carries this file. The release commit is the annotated tag `v3.12.0` after the squash, which does not exist yet.
- Tests, 29 October 2026, this machine, Node v24.20.0:
  - `npm test`: 109 passed, 0 failed.
  - `npm audit --audit-level=low`: 0 vulnerabilities.
  - `tests/browser/polygon-recipe.spec.js` on Chromium, Firefox and WebKit, `HEXSHIFT_PORT=4184`: 18 passed. That covers displayed close, rubber-band ink, history, zoomed CSS-pixel close including a synthetic touch, a click just outside the bitmap, late Escape, row and tool changes, each omission on its own and together, legacy and explicit-none recipes, cancel and a stale revision, source-only versus other tabs, Files to ZIP, outline-only save, and an imported recipe over an existing polygon.
  - Full Playwright suite, `HEXSHIFT_PORT=4184`, 3 workers: 345 passed, 8 skipped, 1 failed. The skips are the existing Firefox and WebKit skips. The failure was WebKit `Cancel appears only after a long wait, in its own place`: `#cancel` stayed hidden for the 800 ms the test allows. That timer is unchanged in this version. Rerun alone on WebKit: 1 passed. The other 345 were not rerun after that.
- Manual evidence: `docs/manual-tests.md` is not in this repository, and that checklist was not run by hand. `HostTests.exe verify-release` was not run, so this is not `RELEASE CHECK PASSED`.
- Blockers: none in the editor code. Publication still needs the pull request, checks, windows-app, the tag, and approval of the protected `release` environment.
- Artifact hashes: local portable shell `b986f09c5957a95e`. Nothing published.
- Release URL: none.

## 3.13.0 — Explicit, bounded import downscaling

- State: not started.

## Animation prototype

- State: not started. It does not block 3.11.0, 3.12.0 or 3.13.0, and it does not add animation to those releases.
