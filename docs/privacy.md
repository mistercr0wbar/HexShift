# Hex Shift privacy

Updated 29 October 2026 for version 3.10.0 (browser and Windows).

Images are processed on your device. Images, selections, edits and undo history
stay in memory and are lost when the page closes or reloads, unless you save a
session. They are never stored in localStorage or sent to the developer. Hex
Shift has no accounts, advertising, analytics, tracking or cloud image
processing.

Up to 20 image tabs can be open in one session, with separate edits and views.
Their undo history shares a 96 MB budget, with background history trimmed first.
Tab order, images and batch work are not saved automatically. **Save session**
writes the open images and their edits into a file you choose. That file
contains the pictures, selections, colour maps, outlines, variant colours and
export framing (trim, padding and scaling). A colour can also keep a polygon
that limits it to part of the picture. A session with no polygon field has no
polygon, so an older session still opens. A session saved by 3.8.0 has no
framing fields, which means framing is off.
It does not contain undo history, and it is not the layout, theme or mode
setting. It stays only where you saved it. Export remains the way to save one
finished picture.

The theme preference is kept as `hexshift-theme`. The workspace arrangement is
kept as `hexshift-layout`: where the panels sit, including panels placed
beside each other and panels grouped as tabs, which you have folded or
hidden, the column sizes you chose, and the order of the phone sheet's tabs. A narrower window may show those columns smaller; the stored sizes are the ones you chose. It does not
store images, selections, or edits. An unreadable arrangement is ignored and
left as it is. Whether the getting-started tip has already been shown is kept
as `hexshift-introduced`. A profile that already has a theme, a layout or
saved colours does not see that tip again, including after an update. Whether
the next launch opens in Simple or Advanced is kept as `hexshift-mode`
(`simple` or `advanced`). Reset layout does not clear it. A profile that
already has a layout or saved colours stays in Advanced; the theme does not
choose the mode, because it is written on startup. A new profile is shown
Advanced once and asked. Leaving that question unanswered stores nothing and
asks again next launch. Colours you explicitly save
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
