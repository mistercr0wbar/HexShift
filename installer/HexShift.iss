; Keep this AppId for future HexShift installers.
#ifndef AppVersion
  #error Pass /DAppVersion=major.minor.patch (or use scripts/installer.ps1).
#endif
#define AppVersionInfo AppVersion + ".0"
#define AppExe AddBackslash(SourcePath) + "..\app\bin\Release\net48\HexShift.exe"
#if FileExists(AppExe)
  #if GetVersionNumbersString(AppExe) != AppVersionInfo
    #error AppVersion disagrees with the built HexShift.exe file version.
  #endif
#endif

[Setup]
AppId={{44A94DA7-51B1-4BE0-BB05-9E1486733DEA}
AppName=HexShift
AppVersion={#AppVersion}
AppPublisher=mistercr0wbar
AppPublisherURL=https://github.com/mistercr0wbar/HexShift
AppSupportURL=https://github.com/mistercr0wbar/HexShift/issues
DefaultDirName={localappdata}\Programs\HexShift
DefaultGroupName=HexShift
PrivilegesRequired=lowest
MinVersion=10.0.17763
DisableProgramGroupPage=yes
DisableWelcomePage=no
UsePreviousAppDir=yes
UsePreviousTasks=yes
UninstallDisplayName=HexShift
UninstallDisplayIcon={app}\HexShift.exe
SourceDir=..
OutputDir=dist
OutputBaseFilename=HexShift-{#AppVersion}-Setup
SetupIconFile=app\icon.ico
VersionInfoVersion={#AppVersionInfo}
VersionInfoProductName=HexShift
VersionInfoDescription=HexShift per-user installer
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
CloseApplicationsFilter=HexShift.exe
RestartApplications=no
SetupLogging=yes

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: checkedonce

[Files]
Source: "app\bin\Release\net48\HexShift.exe"; DestDir: "{app}"
Source: "LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "THIRD_PARTY_NOTICES.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "installer\INSTALLATION.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\HexShift"; Filename: "{app}\HexShift.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\HexShift"; Filename: "{app}\HexShift.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\HexShift.exe"; Description: "Launch HexShift"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  { ssDone is reached only when installation has completed successfully. }
  if (CurStep = ssDone) and WizardSilent then
  begin
    if MsgBox('HexShift was updated. Open it now?', mbConfirmation,
      MB_YESNO or MB_DEFBUTTON2) = IDYES then
    begin
      if not ExecAsOriginalUser(ExpandConstant('{app}\HexShift.exe'), '',
        ExpandConstant('{app}'), SW_SHOWNORMAL, ewNoWait, ResultCode) then
        MsgBox('HexShift could not be opened. Please use its Start menu shortcut.',
          mbError, MB_OK);
    end;
  end;
end;
