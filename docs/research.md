# Recolouring-tool research

Reviewed 21 October 2026. These are documented/exposed capabilities, not comparative image-quality or security certifications. No personal images were uploaded to these services.

| Tool                                                                | Useful capabilities                                                         | HexShift decision                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [imgxcolor](https://imgxcolor.com/pages/recolor-image)              | Source/target, tolerance, softness, shading protection, export controls     | Keep a short live-preview workflow.                                                                      |
| [ToodleTools](https://toodletools.com/tools/change-color-in-image/) | Mask preview, shade preservation, edge refinement, transparency replacement | Add explicit selection views and distinguish match softness from spatial feather.                        |
| [CodeShack](https://codeshack.io/image-color-replacer/)             | Magnifier, image palette, clipboard, chained replacements, export formats   | Add pixel loupe, representative source swatches and clearer Apply action.                                |
| [LunaPic](https://www2.lunapic.com/editor/?action=replace-color)    | Full replacement versus softer tint, undo/history                           | Separate Shift, Flat and Transparent treatments.                                                         |
| [OptiPix](https://optipix.art/color-changer)                        | Modes, comparison, undo/redo and batch workflows                            | Adopt comparison/history, defer batch and broader photo effects.                                         |
| [Irrational Tools](https://irrationaltools.com/color-replacer/)     | Region constraints, zoom/pan, multiple pairs, transparency, history         | Keep connected selection and multi-sampling; add a simple corrective brush. Defer polygon/lasso editing. |

The design preserves HexShift's neutral/coloured pixel separation, independent hue and shade tolerances, and shading caps. It prioritizes emoji, icons and transparent assets, with a 320px desktop inspector and canvas-first mobile layout. Scope excludes AI effects, batch processing, projects and reusable recipes.

## Second review: 26 October 2026

A wider pass covered icon libraries (Icons8, Flaticon, Noun Project, Iconify, Streamline), SVG recolourers (AllSVGIcons, Wallpapers.com, shadcn.io), emoji/sticker/emote makers (ezgif, Eklipse, MakeEmoji, Kapwing, LottieFiles), design tools (Figma, Penpot, Canva, Firefly), raster editors (Photoshop, GIMP 3, Affinity Photo 2, Krita, Paint.NET 5), vector recolour (Illustrator Recolor Artwork, Inkscape, Affinity Designer), pixel-art palette tools (Aseprite, Pixelorama, Lospec), palette tools (Coolors, Adobe Color, oklch.com, Leonardo), batch tools (ImageMagick, XnConvert, Photoshop Actions) and the skin-tone palettes of Fluent, Twemoji, Noto and OpenMoji.

| Finding | Seen in | HexShift decision |
| ------- | ------- | ----------------- |
| The key colour lands exactly; other shades scale around it | Illustrator Tints and Shades / Scale Tints | 2.2: anchored shading replaces clamping |
| Hue rotation in a perceptual space keeps brightness | ImageMagick LCHab, GIMP LCh, oklch.com | 2.2: Perceptual (OKLCH) model, default |
| Colour-to-alpha unmixing leaves clean edges | GIMP, Krita, Affinity matte removal, ezgif edge clean-up | 2.2: Clean edges |
| Outline/backing so stickers read on any background | Icons8, Noun Project, WhatsApp guidance | 2.2: Outline and real-size preview |
| Platform sizes, packs and file-size limits | MakeEmoji, Eklipse, Kapwing, Flaticon | Planned: export presets, ZIP packs |
| Colourways, palettes and skin tones | Firefly, LottieFiles, Lospec, Canva; no raster skin-tone tool exists | Planned: variants, palette files, skin-tone ramps |
| Current→New colour tables and reusable recipes | Illustrator, Figma, Penpot, Actions, XnConvert | Planned: colour map, recipe files and batch |

This reverses the earlier exclusion of batch processing and reusable recipes: both are planned, as files the user saves (nothing stored in the app). Animated GIF recolouring and SVG output remain deferred.
