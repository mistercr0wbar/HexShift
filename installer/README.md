Build the Windows app in Release using the SDK in `global.json`:

```powershell
dotnet restore app/HexShift.csproj --locked-mode -warnaserror:NU1901,NU1902,NU1903,NU1904
dotnet build app/HexShift.csproj -c Release --no-restore
./scripts/package.ps1 -BuildInstaller -IsccPath 'C:\path\to\ISCC.exe'
```

The existing `./scripts/package.ps1` command still packages the portable files.
Add `-BuildInstaller` to also produce `dist/HexShift-{version}-Setup.exe` and
append its hash to the root `SHA256SUMS.txt`. Alternatively, run
`./scripts/installer.ps1` after packaging. Both scripts accept `-AppVersion`;
it must match the built EXE's product and file versions. Omit it to read the
product version from the EXE. Use stable three-part versions; the installer
uses a zero fourth component for its Windows version resource.

The recipe can also be compiled with `ISCC.exe /DAppVersion=2.0.0
installer/HexShift.iss`. It retains the original per-user AppId, installation
directory, shortcuts and uninstall behavior. It does not remove the profile
under `%LOCALAPPDATA%\HexShift`.

For an updater, after the user agrees and exports their image, use:

```text
/SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /NORESTARTAPPLICATIONS /RESTARTEXITCODE=3010
```

`CloseApplications=yes` uses Windows Restart Manager to close applications
holding the installed EXE. The updater should exit HexShift before starting
installation and check the installer exit code. Do not force-close an editor
with unsaved work. `RestartApplications=no` and the `[Run]` `skipifsilent` flag
leave reopening to the updater. Verify closing and upgrading on a disposable
Windows user or VM before release.

A `/DIR=` pointing at TEMP does not isolate the real uninstall registration
or shortcuts for this AppId. Do not smoke-install this recipe in an account
with a real HexShift installation. CI publishing is unchanged in this round.
