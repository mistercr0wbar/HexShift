// Hex Shift - the update service.
//
// Check, download, install: the whole flow with no window in it, so it can be driven
// from a test as easily as from the notice bar. The addresses it may use come in as
// UpdateEndpoints; the release build always uses UpdateEndpoints.Release().
//
// C# 5 on purpose, like the rest of the host.

using System;
using System.IO;
using System.Text;
using System.Threading;

namespace HexShift
{
    // The addresses and the rules about them, in one place so tests can point the service at a
    // local server without loosening what the release build accepts.
    sealed class UpdateEndpoints
    {
        internal string FeedUrl;
        internal Func<string, bool> IsFeed;
        internal Func<string, string, bool> IsInstaller;
        internal Func<string, bool> IsFeedRedirect;
        internal Func<string, bool> IsInstallerRedirect;
        internal int MaxFeedRedirects;
        internal int MaxInstallerRedirects;
        internal TimeSpan FeedDeadline;
        internal TimeSpan InstallerDeadline;

        internal static UpdateEndpoints Release()
        {
            UpdateEndpoints endpoints = new UpdateEndpoints();
            endpoints.FeedUrl = UpdatePolicy.FeedUrl;
            endpoints.IsFeed = UpdatePolicy.IsFeedAddress;
            endpoints.IsInstaller = UpdatePolicy.IsInstallerAddress;
            endpoints.IsFeedRedirect = UpdatePolicy.IsAllowedRedirect;
            endpoints.IsInstallerRedirect = UpdatePolicy.IsInstallerRedirect;
            endpoints.MaxFeedRedirects = UpdatePolicy.MaxFeedRedirects;
            endpoints.MaxInstallerRedirects = UpdatePolicy.MaxInstallerRedirects;
            endpoints.FeedDeadline = UpdatePolicy.FeedDeadline;
            endpoints.InstallerDeadline = UpdatePolicy.InstallerDeadline;
            return endpoints;
        }

        // The feed and its signature share one route: same first address rule, same redirects.
        internal UpdateRoute ForFeed()
        {
            UpdateRoute route = new UpdateRoute();
            route.First = IsFeed;
            route.Redirect = IsFeedRedirect;
            route.MaxRedirects = MaxFeedRedirects;
            route.Deadline = FeedDeadline;
            return route;
        }

        // An installer request starts only at that exact version's release file and may only be
        // redirected to the CDN.
        internal UpdateRoute ForInstaller(string version)
        {
            UpdateRoute route = new UpdateRoute();
            route.First = delegate(string url) { return IsInstaller(url, version); };
            route.Redirect = IsInstallerRedirect;
            route.MaxRedirects = MaxInstallerRedirects;
            route.Deadline = InstallerDeadline;
            return route;
        }
    }

    enum CheckKind { Disabled, Failed, UpToDate, Available }

    sealed class CheckOutcome
    {
        public CheckKind Kind;
        public string Message;
        public UpdateOffer Offer;

        internal static CheckOutcome Of(CheckKind kind, string message)
        {
            CheckOutcome outcome = new CheckOutcome();
            outcome.Kind = kind;
            outcome.Message = message;
            return outcome;
        }
    }

    sealed class UpdateService
    {
        readonly string dataDir;
        readonly byte[] publicKey;
        readonly string currentVersion;
        readonly UpdateEndpoints endpoints;
        readonly UpdateTransport transport;
        readonly UpdateSettings settings;

        internal UpdateService(string dataDir, byte[] publicKey, string currentVersion, UpdateEndpoints endpoints, UpdateTransport transport)
        {
            this.dataDir = dataDir;
            this.publicKey = publicKey;
            this.currentVersion = currentVersion;
            this.endpoints = endpoints;
            this.transport = transport;
            settings = UpdateSettings.Load(dataDir);
        }

        // The release configuration: the built-in key, the real addresses, the running version.
        internal static UpdateService ForRelease(string dataDir)
        {
            return new UpdateService(dataDir, LoadPublicKey(), Program.Version, UpdateEndpoints.Release(), UpdateTransport.ForRelease());
        }

        // The key is an embedded resource. A build without a real key (the "NOT-SET" placeholder)
        // has updates switched off rather than unchecked.
        static byte[] LoadPublicKey()
        {
            try
            {
                using (Stream s = typeof(UpdateService).Assembly.GetManifestResourceStream("UpdatePublicKey.txt"))
                {
                    if (s == null) return null;
                    using (StreamReader reader = new StreamReader(s, Encoding.ASCII)) return UpdateFeed.ParsePublicKey(reader.ReadToEnd());
                }
            }
            catch (IOException) { return null; }
        }

        internal bool Enabled { get { return publicKey != null; } }
        internal string CurrentVersion { get { return currentVersion; } }

        internal bool AutoCheck
        {
            get { return settings.AutoCheck; }
            set { settings.AutoCheck = value; settings.Save(dataDir); }
        }

        // Whether a check belongs at this launch: every launch, when automatic checks are on.
        internal bool CheckAtLaunch
        {
            get { return Enabled && UpdatePolicy.ShouldCheckAtLaunch(settings.AutoCheck); }
        }

        // When the last successful check finished (UTC), or DateTime.MinValue if none has.
        internal DateTime LastCheckUtc { get { return settings.LastCheckUtc; } }

        // Blocks, so call it from a worker thread. Network and verification problems come back as
        // Failed with a sentence for the user; only cancellation is thrown.
        internal CheckOutcome Check(CancellationToken token)
        {
            if (!Enabled) return CheckOutcome.Of(CheckKind.Disabled, "This build of HexShift has no update key, so it cannot check for updates.");
            try
            {
                UpdateRoute route = endpoints.ForFeed();
                byte[] feed = transport.GetBytes(endpoints.FeedUrl, route, UpdatePolicy.MaxFeedBytes, token);
                byte[] signature = transport.GetBytes(endpoints.FeedUrl + ".signature", route, UpdatePolicy.MaxSignatureBytes, token);
                FeedResult result = UpdateFeed.Evaluate(feed, Encoding.ASCII.GetString(signature), publicKey, currentVersion, endpoints.IsInstaller);
                if (result.Status == FeedStatus.Rejected) return CheckOutcome.Of(CheckKind.Failed, result.Reason);

                settings.LastCheckUtc = DateTime.UtcNow;
                settings.Save(dataDir);
                if (result.Status == FeedStatus.UpToDate) return CheckOutcome.Of(CheckKind.UpToDate, "HexShift " + currentVersion + " is up to date.");
                CheckOutcome outcome = CheckOutcome.Of(CheckKind.Available, "HexShift " + result.Offer.Version + " is available.");
                outcome.Offer = result.Offer;
                return outcome;
            }
            catch (UpdateException ex) { return CheckOutcome.Of(CheckKind.Failed, ex.Message); }
        }

        // Blocks. Returns the path of the verified installer, or throws UpdateException.
        internal string Download(UpdateOffer offer, Action<long, long> progress, CancellationToken token)
        {
            if (!Enabled) throw new UpdateException("This build of HexShift has no update key.");
            return UpdateInstaller.Stage(transport, endpoints, offer, dataDir, publicKey, progress, token);
        }

        // Starts the verified installer. An installed copy gets the fixed silent switches and is
        // expected to close itself right afterwards; a portable copy just opens the normal wizard.
        internal void Install(UpdateOffer offer, string stagedPath, bool installedCopy)
        {
            if (!Enabled) throw new UpdateException("This build of HexShift has no update key.");
            UpdateInstaller.Launch(stagedPath, offer, dataDir, publicKey, installedCopy ? UpdatePolicy.InstallerArguments : "");
        }
    }
}
