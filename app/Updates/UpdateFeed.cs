// Hex Shift - reading the update feed.
//
// The feed is NetSparkle 3.1.0's JSON appcast. Nothing in it is believed until its
// Ed25519 signature checks out against the public key built into the app, and even
// then every entry has to pass UpdatePolicy before it can be offered. Pure: bytes in,
// answer out, no network and no disk, so each rule can be checked on its own.
//
// C# 5 on purpose, like the rest of the host.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Web.Script.Serialization;
using Chaos.NaCl;

namespace HexShift
{
    enum FeedStatus { Rejected, UpToDate, Available }

    sealed class UpdateOffer
    {
        public string Version;
        public string Url;
        public string Signature;
        public long Size;
        public string Notes;
    }

    sealed class FeedResult
    {
        public FeedStatus Status;
        public string Reason;
        public UpdateOffer Offer;
    }

    static class UpdateFeed
    {
        internal const int SignatureBytes = 64;
        internal const int PublicKeyBytes = 32;
        const int MaxItems = 50;
        const int MaxNotesChars = 4000;

        // Ed25519 check that never throws: a wrong length, bad base64 or bad signature is just "no".
        internal static bool Verifies(string base64Signature, byte[] data, byte[] publicKey)
        {
            if (data == null || publicKey == null || publicKey.Length != PublicKeyBytes) return false;
            byte[] signature = DecodeSignature(base64Signature);
            if (signature == null) return false;
            try { return Ed25519.Verify(signature, data, publicKey); }
            catch (ArgumentException) { return false; }
        }

        static byte[] DecodeSignature(string base64)
        {
            if (string.IsNullOrEmpty(base64) || base64.Length > 200) return null;
            try
            {
                byte[] bytes = Convert.FromBase64String(base64.Trim());
                return bytes.Length == SignatureBytes ? bytes : null;
            }
            catch (FormatException) { return null; }
        }

        // The public key is base64 of exactly 32 bytes. Anything else, including the "NOT-SET"
        // placeholder in a build that has no key yet, means updates stay switched off.
        internal static byte[] ParsePublicKey(string text)
        {
            if (text == null) return null;
            text = text.Trim();
            if (text.Length != 44) return null;
            try
            {
                byte[] key = Convert.FromBase64String(text);
                return key.Length == PublicKeyBytes ? key : null;
            }
            catch (FormatException) { return null; }
        }

        static FeedResult Reject(string reason)
        {
            FeedResult result = new FeedResult();
            result.Status = FeedStatus.Rejected;
            result.Reason = reason;
            return result;
        }

        // feed and signature are exactly what the server sent; currentVersion is the running app's.
        // isInstaller(url, version) says whether a download address is acceptable for that version;
        // the release build passes UpdatePolicy.IsInstallerAddress.
        internal static FeedResult Evaluate(byte[] feed, string signature, byte[] publicKey, string currentVersion, Func<string, string, bool> isInstaller)
        {
            if (feed == null || feed.Length == 0 || feed.Length > UpdatePolicy.MaxFeedBytes)
                return Reject("The update information has an unexpected size.");
            if (!Verifies(signature, feed, publicKey))
                return Reject("The update information's signature did not check out.");
            if (!UpdatePolicy.IsVersion(currentVersion))
                return Reject("This copy of HexShift has no valid version number.");

            IList items = null;
            try
            {
                JavaScriptSerializer json = new JavaScriptSerializer();
                json.MaxJsonLength = UpdatePolicy.MaxFeedBytes;
                json.RecursionLimit = 16;
                Dictionary<string, object> top = json.DeserializeObject(new UTF8Encoding(false, true).GetString(feed)) as Dictionary<string, object>;
                object list;
                if (top != null && top.TryGetValue("items", out list)) items = list as IList;
            }
            catch (Exception) { return Reject("The update information could not be read."); }
            if (items == null) return Reject("The update information has no list of versions.");

            UpdateOffer best = null;
            string problem = null;
            int seen = 0;
            foreach (object entry in items)
            {
                if (++seen > MaxItems) break;
                Dictionary<string, object> item = entry as Dictionary<string, object>;
                if (item == null || !ForThisSystem(item)) continue;
                string version = Text(item, "version");
                // Equal, older and unreadable versions are ignored, so an old feed cannot roll the app back.
                if (!UpdatePolicy.IsNewer(version, currentVersion)) continue;
                string why = ProblemWith(item, version, isInstaller);
                if (why != null) { problem = why; continue; }
                if (best == null || UpdatePolicy.IsNewer(version, best.Version)) best = ToOffer(item, version);
            }

            FeedResult result = new FeedResult();
            if (best != null) { result.Status = FeedStatus.Available; result.Offer = best; }
            else if (problem != null) return Reject(problem);
            else result.Status = FeedStatus.UpToDate;
            return result;
        }

        // Windows entries on the stable channel only. "darwin" contains "win", so match the start.
        static bool ForThisSystem(Dictionary<string, object> item)
        {
            string os = Text(item, "os");
            string channel = Text(item, "channel");
            return (string.IsNullOrEmpty(os) || os.StartsWith("win", StringComparison.OrdinalIgnoreCase))
                && string.IsNullOrEmpty(channel);
        }

        // Why a newer entry cannot be offered, or null when it can.
        static string ProblemWith(Dictionary<string, object> item, string version, Func<string, string, bool> isInstaller)
        {
            if (!isInstaller(Text(item, "url"), version))
                return "The newest version points at a download address HexShift does not accept.";
            if (DecodeSignature(Text(item, "signature")) == null)
                return "The newest version has no usable installer signature.";
            long size = Number(item, "size");
            if (size <= 0 || size > UpdatePolicy.MaxInstallerBytes)
                return "The newest version's size is missing or too large.";
            return null;
        }

        static UpdateOffer ToOffer(Dictionary<string, object> item, string version)
        {
            UpdateOffer offer = new UpdateOffer();
            offer.Version = version;
            offer.Url = Text(item, "url");
            offer.Signature = Text(item, "signature").Trim();
            offer.Size = Number(item, "size");
            offer.Notes = Clean(Text(item, "description"));
            return offer;
        }

        static string Text(Dictionary<string, object> item, string key)
        {
            object value;
            return item.TryGetValue(key, out value) ? value as string : null;
        }

        static long Number(Dictionary<string, object> item, string key)
        {
            object value;
            if (!item.TryGetValue(key, out value) || value == null || value is string || value is bool) return -1;
            try { return Convert.ToInt64(value, CultureInfo.InvariantCulture); }
            catch (FormatException) { return -1; }
            catch (OverflowException) { return -1; }
            catch (InvalidCastException) { return -1; }
        }

        // Release notes are shown as plain text, so keep them short and drop control characters.
        static string Clean(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            if (text.Length > MaxNotesChars) text = text.Substring(0, MaxNotesChars);
            StringBuilder clean = new StringBuilder(text.Length);
            foreach (char c in text)
                if (c >= ' ' || c == '\r' || c == '\n' || c == '\t') clean.Append(c);
            return clean.ToString();
        }
    }
}
