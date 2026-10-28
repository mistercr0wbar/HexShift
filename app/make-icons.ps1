# Draws the Hex Shift icon: an upright # on a graphite tile, split corner to corner
# at 45 degrees, orange above the split and cyan below. The # is symmetrical about
# its centre, so the split gives both colours exactly the same area.
# Writes app\icon.ico, the PWA icons and the Android adaptive-icon layers.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File app\make-icons.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $root 'icons'
$android = Join-Path $icons 'android'
New-Item -ItemType Directory -Force $icons, $android | Out-Null

$graphite = [System.Drawing.Color]::FromArgb(255, 0x26, 0x26, 0x26)
$orange = [System.Drawing.Color]::FromArgb(255, 0xE8, 0x80, 0x2E)
$cyan = [System.Drawing.Color]::FromArgb(255, 0x6E, 0xF0, 0xFF)

# The # in a 70-unit design (15..85 on a 100-unit grid): strokes at 33..45 and
# 55..67, bars at the same places across, all 70 long. $span is the share of the
# box the # covers. With $snap, every edge lands on a whole pixel (crisp at 16-64 px):
# each edge is rounded on one side and mirrored about the centre to the other, so
# the # stays symmetrical and the split stays exactly even.
function Hash-Path([float]$x0, [float]$y0, [float]$box, [float]$span, [bool]$snap) {
    $u = $box * $span / 70
    $cx = $x0 + $box / 2; $cy = $y0 + $box / 2
    $pair = {
        param([float]$c, [float]$k)
        if ($snap) { $hi = [Math]::Round($c + $k); return @((2 * $c - $hi), $hi) }
        return @(($c - $k), ($c + $k))
    }
    $xi = & $pair $cx (5 * $u); $xo = & $pair $cx (17 * $u); $xe = & $pair $cx (35 * $u)
    $yi = & $pair $cy (5 * $u); $yo = & $pair $cy (17 * $u); $ye = & $pair $cy (35 * $u)
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath ([System.Drawing.Drawing2D.FillMode]::Winding)
    # Strokes (left, right), then bars (top, bottom).
    $p.AddRectangle((New-Object System.Drawing.RectangleF $xo[0], $ye[0], ($xi[0] - $xo[0]), ($ye[1] - $ye[0])))
    $p.AddRectangle((New-Object System.Drawing.RectangleF $xi[1], $ye[0], ($xo[1] - $xi[1]), ($ye[1] - $ye[0])))
    $p.AddRectangle((New-Object System.Drawing.RectangleF $xe[0], $yo[0], ($xe[1] - $xe[0]), ($yi[0] - $yo[0])))
    $p.AddRectangle((New-Object System.Drawing.RectangleF $xe[0], $yi[1], ($xe[1] - $xe[0]), ($yo[1] - $yi[1])))
    return $p
}

# Fills the # cyan, then lays the orange half over it, clipped to the triangle above
# the box's top-right to bottom-left diagonal: one clean edge, no seam.
function Fill-Hash($g, [float]$x0, [float]$y0, [float]$box, [float]$span, $top, $bottom, [bool]$snap = $false) {
    $hash = Hash-Path $x0 $y0 $box $span $snap
    $b = New-Object System.Drawing.SolidBrush $bottom
    $g.FillPath($b, $hash); $b.Dispose()
    $tri = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tri.AddPolygon([System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF $x0, $y0),
        (New-Object System.Drawing.PointF ($x0 + $box), $y0),
        (New-Object System.Drawing.PointF $x0, ($y0 + $box))))
    $g.SetClip($tri, [System.Drawing.Drawing2D.CombineMode]::Intersect)
    $t = New-Object System.Drawing.SolidBrush $top
    $g.FillPath($t, $hash); $t.Dispose()
    $g.ResetClip()
    $tri.Dispose(); $hash.Dispose()
}

function New-Canvas([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    return @($bmp, $g)
}

# kind: tile (rounded, 4% padding), maskable (full-bleed square), foreground and
# monochrome (Android adaptive layers, transparent), background (solid graphite).
function Draw-Icon([int]$size, [string]$kind) {
    $bmp, $g = New-Canvas $size
    switch ($kind) {
        'tile' {
            $pad = [Math]::Round($size * 0.04)
            $box = $size - 2 * $pad
            $d = $box * 0.44
            $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
            $tile.AddArc($pad, $pad, $d, $d, 180, 90)
            $tile.AddArc($pad + $box - $d, $pad, $d, $d, 270, 90)
            $tile.AddArc($pad + $box - $d, $pad + $box - $d, $d, $d, 0, 90)
            $tile.AddArc($pad, $pad + $box - $d, $d, $d, 90, 90)
            $tile.CloseFigure()
            $fill = New-Object System.Drawing.SolidBrush $graphite
            $g.FillPath($fill, $tile); $fill.Dispose(); $tile.Dispose()
            Fill-Hash $g $pad $pad $box 0.82 $orange $cyan ($size -le 64)
        }
        'maskable' {
            $g.Clear($graphite)
            # Keeps every corner of the # inside the 80% safe circle.
            Fill-Hash $g 0 0 $size 0.70 $orange $cyan
        }
        'foreground' { Fill-Hash $g 0 0 $size 0.54 $orange $cyan }
        'monochrome' { Fill-Hash $g 0 0 $size 0.54 ([System.Drawing.Color]::White) ([System.Drawing.Color]::White) }
        'background' { $g.Clear($graphite) }
    }
    $g.Dispose()
    return $bmp
}

function Png-Bytes([System.Drawing.Bitmap]$bmp) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    ,$ms.ToArray()
}

# PWA icons and favicon
foreach ($s in 192, 512) {
    $b = Draw-Icon $s 'tile'; $b.Save((Join-Path $icons "icon-$s.png")); $b.Dispose()
}
$b = Draw-Icon 512 'maskable'; $b.Save((Join-Path $icons 'icon-512-maskable.png')); $b.Dispose()
$b = Draw-Icon 180 'tile'; $b.Save((Join-Path $icons 'apple-touch-icon.png')); $b.Dispose()
$b = Draw-Icon 32 'tile'; [IO.File]::WriteAllText((Join-Path $icons 'favicon-32.b64'), [Convert]::ToBase64String((Png-Bytes $b))); $b.Dispose()

# Android adaptive icon layers (108 dp at xxxhdpi = 432 px; the # stays inside the
# 66 dp safe circle) for the Android port.
foreach ($k in 'foreground', 'background', 'monochrome') {
    $b = Draw-Icon 432 $k; $b.Save((Join-Path $android "ic_launcher_$k.png")); $b.Dispose()
}

# ICO with PNG-compressed entries (what Windows Vista and later expect for big sizes)
$sizes = 16, 24, 32, 48, 64, 128, 256
$blobs = @()
foreach ($s in $sizes) { $b = Draw-Icon $s 'tile'; $blobs += , (Png-Bytes $b); $b.Dispose() }
$ms = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $ms
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]; $len = $blobs[$i].Length
    $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$len); $w.Write([uint32]$offset)
    $offset += $len
}
foreach ($blob in $blobs) { $w.Write([byte[]]$blob) }
$w.Flush()
[IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'icon.ico'), $ms.ToArray())
"icon.ico, icons\ and icons\android\ written"
