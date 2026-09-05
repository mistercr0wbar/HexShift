# Draws the Hex Shift icon: a rounded tile split on the diagonal, red on one side
# and the cyan it becomes on the other. Writes app\icon.ico and the PWA icons.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File app\make-icons.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $root 'icons'
New-Item -ItemType Directory -Force $icons | Out-Null

function Draw-Tile([int]$size, [bool]$rounded) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = if ($rounded) { [Math]::Round($size * 0.04) } else { 0 }
    $rect = New-Object System.Drawing.RectangleF $pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad)
    $r = if ($rounded) { $rect.Width * 0.22 } else { 0 }

    $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($r -gt 0) {
        $d = $r * 2
        $tile.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
        $tile.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
        $tile.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
        $tile.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
        $tile.CloseFigure()
    } else {
        $tile.AddRectangle($rect)
    }

    # Two halves, each with the same soft top-left light the 3D emoji have.
    $red = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 0xFF, 0x5C, 0x7A)), ([System.Drawing.Color]::FromArgb(255, 0xD9, 0x1E, 0x5C)), 60
    $cyan = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 0x6E, 0xF0, 0xFF)), ([System.Drawing.Color]::FromArgb(255, 0x00, 0xB8, 0xE0)), 60

    $g.SetClip($tile)
    $g.FillRectangle($red, $rect)
    $tri = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tri.AddPolygon([System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF $rect.Right, $rect.Y),
        (New-Object System.Drawing.PointF $rect.Right, $rect.Bottom),
        (New-Object System.Drawing.PointF $rect.X, $rect.Bottom)))
    $g.FillPath($cyan, $tri)
    # A thin light seam along the diagonal so the split reads even at 16px.
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 255, 255, 255)), ([Math]::Max(1, $size * 0.035))
    $g.DrawLine($pen, $rect.Right, $rect.Y, $rect.X, $rect.Bottom)
    $g.ResetClip()

    $g.Dispose(); $red.Dispose(); $cyan.Dispose(); $pen.Dispose(); $tile.Dispose(); $tri.Dispose()
    return $bmp
}

function Png-Bytes([System.Drawing.Bitmap]$bmp) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    ,$ms.ToArray()
}

# PWA icons and favicon
foreach ($s in 192, 512) {
    $b = Draw-Tile $s $true; $b.Save((Join-Path $icons "icon-$s.png")); $b.Dispose()
}
$b = Draw-Tile 512 $false; $b.Save((Join-Path $icons 'icon-512-maskable.png')); $b.Dispose()
$b = Draw-Tile 180 $true; $b.Save((Join-Path $icons 'apple-touch-icon.png')); $b.Dispose()
$b = Draw-Tile 32 $true; [IO.File]::WriteAllText((Join-Path $icons 'favicon-32.b64'), [Convert]::ToBase64String((Png-Bytes $b))); $b.Dispose()

# ICO with PNG-compressed entries (what Windows Vista and later expect for big sizes)
$sizes = 16, 24, 32, 48, 64, 128, 256
$blobs = @()
foreach ($s in $sizes) { $b = Draw-Tile $s $true; $blobs += , (Png-Bytes $b); $b.Dispose() }
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
"icon.ico and icons\ written"
