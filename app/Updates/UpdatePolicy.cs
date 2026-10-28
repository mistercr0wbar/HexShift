// Hex Shift - update rules.
//
// What the updater may ask for, follow, accept and run. Every method only answers
// yes or no and none of them touches the network, so each rule can be checked on
// its own. Arguments are strings, like MainForm.IsAppDocument, and anything that
// does not parse is a no.
//
// C# 5 on purpose, like the rest of the host.

using System;
using System.Globalization;
using System.IO;

namespace HexShift
{
    static class UpdatePolicy
    {
        // The two stable addresses the app asks for. The site only redirects them to a release.
        const string FeedHost = "thecr0wbar.xyz";
        const string FeedPath = "/updates/hexshift/appcast.json";
        const string SignaturePath = "/updates/hexshift/appcast.json.signature";

        // Where releases live. GitHub answers a release file with one redirect to its signed CDN.
        const string ReleaseHost = "github.com";
        const string ReleasePrefix = "/mistercr0wbar/HexShift/releases/download/";
        const string LatestPrefix = "/mistercr0wbar/HexShift/releases/latest/download/";
        static readonly string[] CdnHosts = { "release-assets.githubusercontent.com", "objects.githubusercontent.com" };

        internal const string FeedUrl = "https://" + FeedHost + FeedPath;
        internal const string ReleasesUrl = "https://github.com/mistercr0wbar/HexShift/releases";

        // Ceilings enforced while reading, never taken from the feed.
        internal const int MaxFeedBytes = 256 * 1024;
        internal const int MaxSignatureBytes = 4 * 1024;
        internal const long MaxInstallerBytes = 64L * 1024 * 1024;

        // Redirect budgets. The feed's real path is three redirects (the site to GitHub's "latest"
        // address, to the release's own file, to the CDN) and the installer's is one (the release's
        // file to the CDN); each gets one spare.
        internal const int MaxFeedRedirects = 4;
        internal const int MaxInstallerRedirects = 2;

        // Overall deadlines for a whole request, headers and body together. The per-read timeout alone
        // lets a server that sends a byte every few seconds hold a check open for days.
        internal static readonly TimeSpan FeedDeadline = TimeSpan.FromSeconds(60);
        internal static readonly TimeSpan InstallerDeadline = TimeSpan.FromMinutes(30);

        // The only switches the updater ever passes to an installed copy's installer. Fixed here,
        // never read from the feed. SILENT (not VERYSILENT) keeps Setup's progress window up after
        // HexShift closes; no /SUPPRESSMSGBOXES, so Setup can still ask "open it now?".
        internal const string InstallerArguments = "/SP- /SILENT /NORESTART /CLOSEAPPLICATIONS /NORESTARTAPPLICATIONS /RESTARTEXITCODE=3010";

        // When automatic checks are on, HexShift checks once on every launch (a couple of seconds after
        // the page has loaded, so starting is never slowed down) and then again every few hours while
        // the window stays open. The last-check time no longer holds a launch back: it is only shown.
        internal static readonly TimeSpan LaunchDelay = TimeSpan.FromSeconds(2);
        internal static readonly TimeSpan RecheckInterval = TimeSpan.FromHours(6);

        internal static bool ShouldCheckAtLaunch(bool autoCheck)
        {
            return autoCheck;
        }

        // A scheduled check (the launch one or a repeat) starts only when nothing else is going on: not
        // while another check or a download is running, and not once an update has already been found
        // (it is waiting in the notice bar; checking again would only show the same bar).
        internal static bool CanRunScheduledCheck(bool autoCheck, bool busy, bool downloading, bool updateFound)
        {
            return autoCheck && !busy && !downloading && !updateFound;
        }

        // https, the default port, no user:password@, no fragment.
        static bool TryHttps(string url, out Uri uri)
        {
            return Uri.TryCreate(url, UriKind.Absolute, out uri) && uri.Scheme == "https" && uri.IsDefaultPort
                && string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Fragment);
        }

        // The first request for the feed or its signature.
        internal static bool IsFeedAddress(string url)
        {
            Uri uri;
            return TryHttps(url, out uri) && uri.Host == FeedHost && string.IsNullOrEmpty(uri.Query)
                && (uri.AbsolutePath == FeedPath || uri.AbsolutePath == SignaturePath);
        }

        // The first request for the installer: this project's release for exactly this version.
        internal static bool IsInstallerAddress(string url, string version)
        {
            Uri uri;
            string tag, file;
            return IsVersion(version) && TryHttps(url, out uri) && TryReleaseFile(uri, out tag, out file)
                && tag == version && IsInstallerFileName(file, version);
        }

        // Every later hop of a FEED request. A redirect may only land on one of this project's
        // release files or on GitHub's asset CDN; anywhere else the request is abandoned.
        internal static bool IsAllowedRedirect(string url)
        {
            Uri uri;
            if (!TryHttps(url, out uri)) return false;
            if (uri.Host == ReleaseHost) return IsReleaseFile(uri) || IsLatestFeedFile(uri);
            return Array.IndexOf(CdnHosts, uri.Host) >= 0;
        }

        // Every later hop of an INSTALLER request: GitHub's asset CDN and nothing else. The first
        // address already names the exact release file, so the only redirect expected is to the CDN.
        internal static bool IsInstallerRedirect(string url)
        {
            Uri uri;
            return TryHttps(url, out uri) && Array.IndexOf(CdnHosts, uri.Host) >= 0;
        }

        // /mistercr0wbar/HexShift/releases/download/v2.1.0/<file>
        static bool TryReleaseFile(Uri uri, out string version, out string file)
        {
            version = null;
            file = null;
            if (uri.Host != ReleaseHost || !string.IsNullOrEmpty(uri.Query)) return false;
            string path = uri.AbsolutePath;
            if (!path.StartsWith(ReleasePrefix, StringComparison.Ordinal)) return false;
            string[] parts = path.Substring(ReleasePrefix.Length).Split('/');
            if (parts.Length != 2 || parts[0].Length < 2 || parts[0][0] != 'v' || !IsVersion(parts[0].Substring(1))) return false;
            version = parts[0].Substring(1);
            file = parts[1];
            return true;
        }

        static bool IsReleaseFile(Uri uri)
        {
            string version, file;
            return TryReleaseFile(uri, out version, out file)
                && (file == "appcast.json" || file == "appcast.json.signature" || IsInstallerFileName(file, version));
        }

        // The site's redirect may point at GitHub's "latest" address, but only for the two feed
        // files. The installer is always fetched from a named version.
        static bool IsLatestFeedFile(Uri uri)
        {
            return string.IsNullOrEmpty(uri.Query)
                && (uri.AbsolutePath == LatestPrefix + "appcast.json" || uri.AbsolutePath == LatestPrefix + "appcast.json.signature");
        }

        internal static bool IsInstallerFileName(string file, string version)
        {
            return IsVersion(version) && file == "HexShift-" + version + "-Setup.exe";
        }

        // Exactly major.minor.patch in plain digits: "2.1.0" yes; "2.1", "2.1.0-beta", "v2.1.0" and "02.1.0" no.
        internal static bool IsVersion(string value)
        {
            int[] parts;
            return TryParseVersion(value, out parts);
        }

        static bool TryParseVersion(string value, out int[] parts)
        {
            parts = null;
            if (string.IsNullOrEmpty(value)) return false;
            string[] pieces = value.Split('.');
            if (pieces.Length != 3) return false;
            int[] numbers = new int[3];
            for (int i = 0; i < 3; i++)
            {
                string piece = pieces[i];
                if (piece.Length == 0 || piece.Length > 5 || (piece.Length > 1 && piece[0] == '0')) return false;
                foreach (char c in piece) if (c < '0' || c > '9') return false;
                numbers[i] = int.Parse(piece, CultureInfo.InvariantCulture);
            }
            parts = numbers;
            return true;
        }

        // Strictly newer only. An equal or older version is never offered, so replaying an old
        // feed cannot roll the app back.
        internal static bool IsNewer(string candidate, string current)
        {
            int[] a, b;
            if (!TryParseVersion(candidate, out a) || !TryParseVersion(current, out b)) return false;
            for (int i = 0; i < 3; i++) if (a[i] != b[i]) return a[i] > b[i];
            return false;
        }

        internal static string StagingFolder(string dataDir)
        {
            return Path.Combine(dataDir, "updates");
        }

        // The only file the updater may run: <staging>\HexShift-<version>-Setup.exe, directly
        // inside the staging folder, not in a subfolder and not reached through "..".
        internal static bool IsStagedInstaller(string folder, string path, string version)
        {
            try
            {
                string dir = Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar);
                string full = Path.GetFullPath(path);
                return IsInstallerFileName(Path.GetFileName(full), version)
                    && string.Equals(Path.GetDirectoryName(full), dir, StringComparison.OrdinalIgnoreCase);
            }
            catch (ArgumentException) { return false; }
            catch (NotSupportedException) { return false; }
            catch (PathTooLongException) { return false; }
        }
    }
}
