# Hex Shift

Recolour emoji, icons, stickers and transparent assets without losing their character. Images are processed on your device.

Open [the web app](https://mistercr0wbar.github.io/HexShift/), use the portable `HexShift.html`, or run the Windows executable from a release. The web app can be installed as a PWA and works offline after its shell has loaded.

## Recolour an asset

The image fills the window, with view and zoom controls floating on it. Under it sit the colour map and three panels: **Selection**, **Colour** and **Export** (drag the line above them to resize). On phones and narrow windows one panel shows at a time, picked from the tab bar at the bottom; on touch screens two fingers pinch to zoom and pan.

1. Open, drop or paste an image, or try the built-in Fluent heart.
2. Click a source colour or choose an image-palette swatch. To change several colours at once, use the **colour map**, the row of chips under the image: **+ Add colour** adds a row for the next colour, and each row keeps its own selection, treatment and target, so you can swap red and blue without one change undoing the other. **Map all colours** fills the map with one row per colour family in the image (each keeps its colour until you change it), so you can recolour every part from one list. Where two rows meet, their edges are blended between the new colours, so a recoloured fill and outline meet without a seam. Use **Add sample** (or Shift-click) to include more shades. Connected regions, hue/shade tolerances and an add/subtract brush refine the selection.
3. Set the target colour: type a hex code, `rgb()`, `hsl()` or a colour name, use the colour picker, pick from anywhere on the screen (◎, in Chrome, Edge and the Windows app), or choose from **Palettes and variants**: Discord's button colours, a 12-colour rainbow at equal brightness, skin tones from Fluent, Twemoji, Noto and OpenMoji, or a palette you open or paste (GIMP `.gpl`, Lospec `.hex`, JASC `.pal`, Paint.NET `.txt`, or a list of hex colours). A skin tone maps the light and shadow shades of your selection onto that tone's colours. **Make a variant for each colour** previews the current edit in every colour of the palette; click one to use it, or export them all as one ZIP. Any palette can be saved as a `.gpl` file.
4. Choose a treatment: **Shift colour** keeps the shading, **Flat colour** uses an exact hex, and **Make transparent** removes selected pixels. Every shade takes the target colour's hue, so the result is one even colour, and the blended pixels along a dark outline shift with the fill, so no rim of the old colour is left. With shading protection on (the default), the sampled colour lands exactly on your target and the other shades scale around it instead of clipping. The **Perceptual** colour model (default) keeps brightness when the hue changes, so yellow turned blue stays light; **Classic HSL** is still available. **Clean edges** removes the colour from blended edge pixels too, so a white background leaves no pale halo.
5. Optionally add an **outline** (width as a percentage of the image, any colour) so an emoji stays visible on a background of its own colour, such as a Discord button. The real-size preview shows the result at 16–96 px on chat backgrounds and Discord button colours.
6. Choose a **Size**: the original, a custom longest side, or a platform size (Discord emoji 128 px and sticker 320 px, Slack emoji 128 px, Twitch emotes 112/56/28 px, Telegram sticker 512 px and emoji 100 px, WhatsApp sticker 512 px with its 96 px tray icon, YouTube emoji 48 px). Platform sizes centre the artwork on a transparent square where the platform needs one, and the readout shows each file's size against the platform's limit. Twitch and WhatsApp save one ZIP with every file.
7. Export as PNG, lossless WebP or small WebP (lossy, made as small as the limit needs), or copy PNG. Export includes every colour in the map. **Apply, then build on the result** bakes the map into the image when you want one change to build on another. Undo and Redo also cover selection and brush changes.

Compare with the original or the image before your current edit. Result, side-by-side and wipe views share zoom/pan. Preview backgrounds never change the exported transparency. At Original size, export dimensions match the imported raster dimensions, except that an outline grows the canvas where the artwork is too close to an edge.

**Recipes and batch** (in Export) save your colour changes as a recipe (`.json`) that repeats them on other images; recipes keep colours, not places, so brush strokes and connected-region limits are left out. Apply a recipe to the open image, or apply your changes to up to 100 images at once and get one ZIP at the chosen size and format, with `errors.txt` listing any image that could not be done.

**Themes** (the Theme button in the top bar): Default (neutral graphite, so only your image is in colour), Lude (graphite and orange), Nord, Everforest, and System, which follows your accent colour and light or dark app mode in the Windows app (the light or dark setting and, where the browser exposes it, the accent elsewhere) and changes when they do. Each theme has four modifiers: **Default** (its own look), **Day** (light), **Night** (deeper and darker) and **Contrast** (pitch black with the theme colour boosted; for System, your accent). Every combination meets WCAG AA contrast. Without a saved choice, a system set to increase contrast starts on Contrast, and a light system on Day.

Keyboard: Ctrl/Cmd O opens, Ctrl/Cmd Z undoes, Ctrl/Cmd Shift Z redoes, F fits, +/− zooms, Space-drag pans, Escape clears selection, and the arrow keys move between choices in a group. Text fields retain their standard editing shortcuts. Colour swatches support keyboard selection.

## File support and privacy

- PNG, JPEG, WebP and GIF: at most **16 MiB**, **4,194,304 pixels**, **8,192 pixels per side**. Animated GIF/WebP open as stills using the first frame.
- Static SVG: at most **2 MiB**, **5,000 elements**, **64 nesting levels**. Shapes, paths, text, gradients, clipping, masks (including `mask-type`), blend modes and filter effects such as the inner shadows in Fluent Color emoji are supported. Files exported by Illustrator, Inkscape, Sketch, Figma and icon sets open too: editor metadata and private data are set aside, `<use>` and `<symbol>` become plain copies (counted against the 5,000-element limit, so references cannot multiply), simple stylesheets (class, id and element rules) are applied to each shape, and document types may declare plain-text entities only (no nesting, files or parameters). Scripts, events, external resources, embedded images (including `feImage`), animation, and any other entity or reference are rejected. SVGs are drawn at 512 px on their longest side (256, 1024 or 2048 px under **SVG drawn at**), keeping the shape given by their width and height or viewBox; widths and heights may be fractional or use px, pt, pc, in, cm or mm.
- Recipes (`.json`): at most **64 KB**, 32 steps, 16 colours per step and 64 samples per step, read as data and checked field by field.
- Images and editing history remain in memory. Only your theme choice (theme and modifier) is stored. There are no third-party scripts, fonts, analytics, image uploads, accounts or remote-processing services. The hosted version contacts GitHub Pages to load/check the application shell; normal browser and hosting request metadata still applies. The Windows app (2.1.0 and newer) makes network requests only to check for and download updates, from `thecr0wbar.xyz` and GitHub, and reads your Windows accent colour and app mode for the System theme (they stay on your PC); you can switch the automatic check off, and your images are never sent.
- Reloading loses the editing session. Close all Hex Shift tabs after exporting to activate a pending offline update.

The Windows app uses an isolated, locally served WebView2 origin and denies remote content. Keep Windows, your browser and the Evergreen WebView2 runtime current. Read [the security review](docs/security-review.md) for evidence and limitations; no application can guarantee immunity to platform vulnerabilities or a compromised device.

## Windows installer and updates

From version 2.1.0 each release also has a per-user installer (`HexShift-{version}-Setup.exe`, no administrator needed). The installed or portable app can check for updates: at most once a day it reads a signed feed, shows a notice with release notes, and only downloads after you click **Download update** and only installs after a second confirmation. Switch the automatic check off, or check by hand, from the window's system menu. Every feed and installer is verified with an Ed25519 signature against a public key built into the app, which is separate from Windows publisher signing (not yet provisioned). A portable copy opens the installer instead of replacing itself. Read [how updates work and how a release is signed](docs/updates.md).

## Development

Use Node.js 24 and the .NET 8 SDK (for Windows builds). Dependencies are pinned in npm/NuGet lockfiles.

```text
npm ci --ignore-scripts
npm run build
npm test
npx playwright install chromium firefox webkit
npm run test:browser
npm run serve
```

`npm run build` bundles `src/` into the checked-in, self-contained `HexShift.html` and regenerates the versioned service worker. Do not edit generated files by hand. The build computes CSP hashes; inline edits invalidate those hashes. No Node installation is needed to use the resulting HTML. Modern browsers must support CompressionStream for lossless PNG export.

```text
dotnet restore tests/native/HostTests.csproj --locked-mode
dotnet build tests/native/HostTests.csproj -c Release --no-restore
tests/native/bin/Release/net48/HostTests.exe
```

The Windows app targets .NET Framework 4.8 and embeds the same generated page plus the WebView2 SDK into one executable. Native source remains compatible with C# 5. Tests check URL restrictions and hash verification, including replacement of a tampered loader. The release workflow runs browser/security checks before publishing, emits checksums and attests release provenance. Repository administrators should require the checks job in branch protection.

## Windows download verification

The executable is currently **unsigned**. If Windows warns, check that the file came from this repository's release and compare `Get-FileHash -Algorithm SHA256` with `SHA256SUMS.txt`. GitHub CLI users can verify release provenance with `gh attestation verify HexShift.exe --repo mistercr0wbar/HexShift`. Checksums on the same release do not independently protect against a compromised release account. Code signing requires a publisher identity and remains future work; do not routinely bypass security warnings.

## Licence and credits

Hex Shift is MIT licensed. The sample heart is Microsoft Fluent Emoji (MIT). The self-contained page bundles DOMPurify under Apache-2.0; the Windows executable embeds the Microsoft WebView2 SDK under its own terms. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
