$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = Split-Path -Parent $PSScriptRoot
$distPath = Join-Path $repoRoot 'dist'
New-Item -ItemType Directory -Force -Path $distPath | Out-Null
$exePath = Join-Path $repoRoot 'app/bin/Release/net48/HexShift.exe'
if (-not (Test-Path -LiteralPath $exePath)) { throw 'Build the Windows executable first.' }
Copy-Item -LiteralPath $exePath -Destination $distPath -Force
foreach ($name in @('HexShift.html','README.md','LICENSE','THIRD_PARTY_NOTICES.md')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $name) -Destination $distPath -Force
}
$docPath = Join-Path $distPath 'docs'
New-Item -ItemType Directory -Force -Path $docPath | Out-Null
Get-ChildItem -LiteralPath (Join-Path $repoRoot 'docs') -File | Copy-Item -Destination $docPath -Force
$entries = @('HexShift.exe','HexShift.html','README.md','LICENSE','THIRD_PARTY_NOTICES.md','docs') | ForEach-Object { Join-Path $distPath $_ }
$zipPath = Join-Path $repoRoot 'HexShift.zip'
Compress-Archive -LiteralPath $entries -DestinationPath $zipPath -Force
$files = @((Join-Path $distPath 'HexShift.exe'),(Join-Path $distPath 'HexShift.html'),$zipPath)
$checksums = foreach ($file in $files) {
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    $hash.Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($file)
}
$checksums | Set-Content -LiteralPath (Join-Path $repoRoot 'SHA256SUMS.txt') -Encoding utf8
Write-Output 'Prepared dist/, HexShift.zip and SHA256SUMS.txt. No release was published.'
