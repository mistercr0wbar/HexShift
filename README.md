# Hex Shift

Recolour one part of an emoji and keep its shading. Click a colour on the
image, type the hex it should become, download the PNG. A deep red heart
turns into a bright cyan one and still looks 3D.

Made for Microsoft's Fluent 3D emoji, but it works on any image: PNG, WebP,
JPG, GIF or SVG, at any size. Transparency is kept.

## Get it

**Open it in the browser** at https://mistercr0wbar.github.io/HexShift/ -
nothing to download. It keeps working offline once it has loaded, and the
address bar offers to install it as an app on Windows, Mac, Android and iOS.

**Windows app:** grab `HexShift.exe` from the
[latest release](https://github.com/mistercr0wbar/HexShift/releases/latest).
One file, about a megabyte, nothing to install; double-click it. Windows
SmartScreen may warn the first time because it is not code-signed: choose
*More info*, then *Run anyway*.

**Just the file:** `HexShift.html` opens in any browser on any system. It is
inside `HexShift.zip` on the release, or right here in the repo.

## How it works

The left side of the window walks through it in three steps.

1. **Pick a colour** by clicking the emoji. Shift-click adds a second colour
   to the same selection. *Tolerance* is how far round the colour wheel a pixel
   may sit from your pick; *Shade range* is how much lighter, darker or greyer
   it may be. Whites, blacks and greys never join a coloured pick, so outlines
   and highlights stay put unless you click them directly. Tick *only the patch
   touching where I clicked* when the same colour appears in two places and you
   want just one.
2. **Shift it.** Type the hex you want the picked colour to become, or use the
   colour picker, and the hue, saturation and brightness sliders set
   themselves. Every other shade in the selection moves by the same amount,
   which is what keeps the 3D look. *Keep the shading intact* caps the sliders
   so nothing in the selection can clip to pure white, black or grey; it tells
   you when it has stepped in. The four Discord button colours are there as
   one-click targets.
3. **Finish.** Download the PNG, or *Apply* to bake that shift in and pick a
   second colour on the same emoji. Undo and Start over do what they say.

Hover over the image to read any pixel's hex. Drop a file on the window or
paste one to open it.

## Building the Windows app

The app is a small .NET Framework 4.8 window hosting Microsoft Edge WebView2,
with the page embedded, so the build output is one `HexShift.exe`. It is built
by the GitHub Actions workflow in `.github/workflows/build.yml` on every push,
and a tag like `v1.2.0` turns that build into a release. To build locally with
the .NET SDK:

    dotnet build app/HexShift.csproj -c Release

The source is written in C# 5 so it also compiles with the `csc.exe` that ships
inside Windows, with no SDK at all; see the comment at the top of
`app/Program.cs`. `app/make-icons.ps1` draws the icon.

## Credits and licence

MIT, see `LICENSE`. The sample heart built into the page is from
[Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (MIT).
The Windows app embeds the
[WebView2 SDK](https://developer.microsoft.com/microsoft-edge/webview2/),
which is Microsoft's and is redistributed under its own licence.
