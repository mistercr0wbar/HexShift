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

The recipe can also be compiled with `ISCC.exe /DAppVersion=2.1.0
installer/HexShift.iss`. It retains the original per-user AppId, installation
directory, shortcuts and uninstall behavior. It does not remove the profile
under `%LOCALAPPDATA%\HexShift`.

For an updater, after the user agrees and exports their image, use:

```text
/SP- /SILENT /NORESTART /CLOSEAPPLICATIONS /NORESTARTAPPLICATIONS /RESTARTEXITCODE=3010
```

These switches match `UpdatePolicy.InstallerArguments`. `/SILENT` keeps the
installation progress window visible after HexShift closes; `/VERYSILENT`
would hide it. Message boxes remain enabled so Setup can ask
"HexShift was updated. Open it now?" after a successful silent installation.
Yes starts HexShift as the original user without waiting; No leaves it closed.
Normal interactive installations use the Finish page's "Launch HexShift"
checkbox instead and never show this extra prompt.

`CloseApplications=yes` uses Windows Restart Manager to close HexShift if it
still holds the installed EXE. The updater starts Setup after the user agrees
and exports their image, then closes itself. Do not force-close an editor with
unsaved work. `RestartApplications=no` prevents automatic Restart Manager
reopening, and the `[Run]` entry keeps `skipifsilent`. The silent prompt uses
`CurStepChanged(ssDone)`, the successful completion hook supported by Inno Setup
6 and 7, and `ExecAsOriginalUser`. Verify the prompt, closing and upgrading on a
disposable Windows user or VM before release.

A `/DIR=` pointing at TEMP does not isolate the real uninstall registration
or shortcuts for this AppId. Do not smoke-install this recipe in an account
with a real HexShift installation. See `docs/updates.md` for the gated release
procedure.
