# Hex Shift privacy

Updated 28 October 2026 for version 3.3.0 (browser and Windows).

Images are processed on your device. Images, selections, edits and undo history
stay in memory and are lost when the page closes or reloads. They are never
stored in localStorage or sent to the developer. Hex Shift has no accounts,
advertising, analytics, tracking or cloud image processing.

The theme preference is kept as `hexshift-theme`. Colours you explicitly save
and palettes you keep in My palettes are stored locally as `hexshift-colours`:
up to 48 saved colours, 50 palettes of 256 colours each, and 256 KB overall.
Only colour codes, palette names and colour labels are kept. Recent targets
and palettes merely opened or pasted remain in memory until explicitly saved.
You can remove a saved colour by right-clicking or holding it (or pressing
Delete while it is focused), and remove a palette with **Remove from My palettes**.
Clearing the app's site data clears these preferences and saved colours.
Browser, portable-file and Windows copies may have separate local stores.
Unavailable storage is reported; an unreadable store is ignored rather than
used as editor data.

The hosted browser version requests its shell from GitHub Pages, which receives
ordinary request metadata. Windows can contact thecr0wbar.xyz and GitHub for
updates, controlled through Help. Images are never included in those requests.
The screen picker runs only when requested: Windows discards its screen
pictures after returning one colour; other supported browsers use EyeDropper.

Questions: open an issue in the HexShift repository without attaching private images.
