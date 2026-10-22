# Updates

How Hex Shift updates itself from version 2.1.0, what the app trusts, and what a
release needs. For people who publish releases; users only need the short
version in the website's Hex Shift page.

## What the app does

- At most once a day when it starts (and any time you pick **Check for updates...**
  in the window's system menu: right-click the title bar, or Alt+Space) it asks
  `https://thecr0wbar.xyz/updates/hexshift/appcast.json` and its `.signature`.
- If a newer version exists it shows a notice bar with **Release notes**,
  **Download update** and **Later**. Nothing is downloaded without a click and
  nothing is installed without a second, separate confirmation that reminds the
  user to export their image.
- An installed copy runs the installer silently and closes itself; Setup asks
  "open it now?". A portable copy only opens the normal installer window and
  keeps running; it never replaces itself.
- Offline or failing checks are silent in the background. Editing is never blocked.
- "Check for updates automatically" can be switched off in the same system menu.
  The choice and the last-check time live in `%LOCALAPPDATA%\HexShift\update-settings.json`.

## What the app trusts

Only the Ed25519 public key built into the EXE (`app/update-public-key.txt`).
Everything else is untrusted input.

1. The feed must carry a valid Ed25519 signature (`appcast.json.signature`,
   base64 of 64 bytes, over the exact bytes of `appcast.json`).
2. Only entries that are Windows, on the stable channel (empty `channel`), strictly
   newer than the running version, with a plain `major.minor.patch` version, a
   signature, a size of at most 64 MiB and a download address of exactly
   `https://github.com/mistercr0wbar/HexShift/releases/download/v{version}/HexShift-{version}-Setup.exe`
   are offered. The tag, the file name and the entry's version must all agree.
3. Each request has its own rules. The feed and its signature may be redirected only to
   this project's release files (including GitHub's "latest" address) or GitHub's asset
   hosts (`release-assets.githubusercontent.com`, `objects.githubusercontent.com`), at most
   four times (the real chain is three: the site, GitHub's latest address, the release's
   file, the CDN). An installer request starts at that exact version's release file and
   may be redirected only to the CDN, at most twice. Always HTTPS. Feed 256 KiB,
   signature 4 KiB, installer 64 MiB: counted while reading, never taken from a header.
   Every request also has an overall deadline (feed 60 seconds, installer 30 minutes), so a
   server that sends one byte at a time cannot hold a check open.
4. The installer must match its signature (over the installer's exact bytes) and the
   size in the signed feed. It is verified again, while held open and locked against
   changes, in the instant before it is started. It is started with fixed switches
   only; nothing in the feed can add arguments.
5. Anything else fails closed: the app says it could not check, or does nothing.
6. The app carries three assemblies inside itself (the two WebView2 ones and the Ed25519
   one). Windows looks for same-named files beside the EXE before it asks the app for the
   embedded copy, and these assemblies would run inside the app (the signature check
   included), so HexShift refuses to start if any of them, or a `HexShift.exe.config`, sits
   next to `HexShift.exe`. A normal install and a normal portable copy contain none of them.

## What this does not defend against

- **Someone already running as you.** A process with your account's rights can change
  HexShift's own files or run anything without help from the updater. The updater narrows
  the window anyway (the staging folder is emptied before each download, the file is
  checked to be where it was put, then held locked and re-verified just before it starts),
  but `Process.Start` opens the installer by path, so a perfectly timed swap by such a
  process cannot be ruled out. Setup itself then re-reads its own file. This is not an
  escalation: the installer runs without administrator rights.
- **Replay of an old signed feed.** The app never accepts an equal or older version, so a
  replayed feed can only mean "no update", but it can hide a newer release until the feed
  is current again. There is no expiry in the feed format.
- **A stolen or lost signing key** (see the key section above) and **Windows publisher
  signing**, which is separate and not set up: SmartScreen may still warn about the
  unsigned installer.
- The installer's signature is checked on the window's own thread. For the real installer
  (a few megabytes) that is a fraction of a second.

`app/Updates/UpdatePolicy.cs` is the one place these rules live; `tests/native/UpdateTests*.cs`
checks each of them, including against a loopback server and a real stand-in installer.

## One-time setup: the signing key

The key pair is made with NetSparkle's generator tool, pinned at **2.9.0**
(it needs a .NET 6 or newer runtime):

```powershell
dotnet tool install NetSparkleUpdater.Tools.AppCastGenerator --version 2.9.0 --tool-path <tools folder>
<tools folder>\netsparkle-generate-appcast --generate-keys --key-path <empty folder you control>
```

- Always pass `--key-path`. Without it the tool writes the keys to
  `%LOCALAPPDATA%\netsparkle`. (It also creates that folder, empty, on every run even
  when `--key-path` is given; delete it if it is empty.)
- `NetSparkle_Ed25519.pub` is one line, 44 characters of base64 (a 32-byte key). Put
  exactly that line in `app/update-public-key.txt` and commit it. A build whose file
  still says `NOT-SET` has updates **switched off** (the menu says so).
- `NetSparkle_Ed25519.priv` is base64 of the 32-byte seed. It must **never** be
  committed, put in the repository, or left on a build machine. Keep an offline backup
  in two places. Store it as a secret named `SPARKLE_PRIVATE_KEY` in a protected GitHub
  environment (required reviewers), and nowhere else.
- If the private key is lost, installed copies cannot be updated by the app; people
  must install a build with a new public key by hand. If it leaks, treat every release
  signed since as suspect and do the same.
- To rotate the key while the old one is still safe: ship one release, signed with the
  old key, whose build carries the new public key. Installed copies verify it with the
  old key and from then on trust only the new one.

## Every release

1. Bump the version in **both** `app/Program.cs` (`Version`) and `app/HexShift.csproj`
   (`<Version>`). `tests/native` fails if they differ, and `scripts/installer.ps1`
   refuses to build an installer whose version differs from the EXE's.
2. Build, test and package (`dotnet restore ... --locked-mode`, `dotnet build -c Release`,
   `HostTests.exe`, `./scripts/package.ps1 -BuildInstaller`).
3. The installer's embedded **ProductVersion** must equal the tag version. The feed
   generator takes each entry's version from the installer file itself (its
   `--file-version` option is only a fallback when the file has none), then builds the
   download address from `--base-url` and the file name. A mismatch produces a feed the
   app refuses, so the release job must fail instead of publishing it.
4. Generate the feed from a folder containing **only** that one installer, with
   `SPARKLE_PRIVATE_KEY` and `SPARKLE_PUBLIC_KEY` set in the environment (the tool needs
   both; this avoids key files and command-line secrets):

   ```powershell
   netsparkle-generate-appcast --binaries <folder with only the installer> --ext exe `
     --output-type json --appcast-output-directory <out> `
     --base-url https://github.com/mistercr0wbar/HexShift/releases/download/v<version> `
     --product-name HexShift --os windows
   ```

   It writes `appcast.json` (UTF-8, no byte-order mark) and `appcast.json.signature`.
   Do not pass `--reparse-existing`: the app only ever offers the newest version, and a
   one-entry feed is easy to check.
5. **Gate: check the exact files about to be published, with the exact code that ships.**
   The test program has a read-only release check (no network) and the release job must
   fail, and publish nothing, unless it exits 0:

   ```powershell
   tests\native\bin\Release\net48\HostTests.exe verify-release `
     --feed <out>\appcast.json --signature <out>\appcast.json.signature `
     --key app\update-public-key.txt --exe dist\HexShift.exe `
     --installer dist\HexShift-<version>-Setup.exe --tag v<version>
   ```

   It confirms that the tag, the installer's file name and its embedded version agree;
   that the public key is real (not `NOT-SET`) and is the very key built into the EXE that
   will ship (read from that EXE's embedded resource, not just from the text file); that the
   EXE's version equals the tag; that the feed and installer signatures verify against that
   key; and that an older copy would be offered exactly this release from exactly this
   address at exactly this size.
6. Publish as a **draft**, upload `HexShift-<version>-Setup.exe`, `appcast.json`,
   `appcast.json.signature`, the portable files and `SHA256SUMS.txt`, check them, then
   publish. `https://thecr0wbar.xyz/updates/hexshift/appcast.json` and `.signature` are
   plain redirects to `releases/latest/download/...`, resolved separately for each
   request, so the feed and its signature must appear together; a signature that does
   not match the feed makes the app reject it and try again later, which is safe.
7. After publishing, fetch both stable addresses and check them against the release.

The Ed25519 signatures protect updates inside the app. They are separate from Windows
publisher signing (code signing), which is not set up and which is what SmartScreen
looks at.
