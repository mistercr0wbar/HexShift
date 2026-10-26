// Checks for the in-app updater: the rules (UpdatePolicy), reading the signed feed
// (UpdateFeed), the saved preferences (UpdateSettings), the guarded downloads
// (UpdateTransport) and the whole check, download and install flow against a
// local server. Everything runs against throwaway keys, a loopback server and a
// fake installer in a temp folder; it never touches the real HexShift install or
// its data folder. See UpdateTests.Network.cs for the server-backed half.
//
// C# 5, like the host.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using Chaos.NaCl;
using HexShift;

static partial class UpdateTests
{
    static int passed;
    static readonly List<string> failures = new List<string>();

    // Throwaway keys. Fixed seeds make failures repeatable; they sign nothing real.
    static byte[] pub, priv, otherPub;

    static void Is(bool expected, bool actual, string label)
    {
        if (expected == actual) { passed++; return; }
        failures.Add("expected " + expected + ": " + label);
    }

    static void Same(string expected, string actual, string label)
    {
        if (expected == actual) { passed++; return; }
        failures.Add(label + ": expected [" + expected + "] but got [" + actual + "]");
    }

    static void Raises<T>(Action action, string label) where T : Exception
    {
        try { action(); }
        catch (T) { passed++; return; }
        catch (Exception ex) { failures.Add(label + ": expected " + typeof(T).Name + " but got " + ex.GetType().Name + " (" + ex.Message + ")"); return; }
        failures.Add(label + ": expected " + typeof(T).Name + " but nothing was thrown");
    }

    internal static int Run()
    {
        byte[] seed = new byte[32];
        for (int i = 0; i < seed.Length; i++) seed[i] = (byte)(i + 1);
        Ed25519.KeyPairFromSeed(out pub, out priv, seed);
        byte[] otherSeed = new byte[32];
        for (int i = 0; i < otherSeed.Length; i++) otherSeed[i] = (byte)(200 - i);
        byte[] ignored;
        Ed25519.KeyPairFromSeed(out otherPub, out ignored, otherSeed);

        string work = Path.Combine(Path.GetTempPath(), "HexShift-update-test-" + Guid.NewGuid().ToString("N"));
        if (!Path.GetFullPath(work).StartsWith(Path.Combine(Path.GetTempPath(), "HexShift-update-test-"), StringComparison.OrdinalIgnoreCase)) throw new Exception("Invalid temporary test path");
        Directory.CreateDirectory(work);
        try
        {
            PolicyChecks(work);
            KeyChecks();
            FeedChecks();
            SettingsChecks(work);
            NetworkChecks(work);
            HardeningChecks(work);
            UiChecks(work);
        }
        finally
        {
            // Best effort: cleaning up must never hide what the checks found.
            try { Directory.Delete(work, true); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        if (failures.Count > 0) throw new Exception(failures.Count + " update check(s) failed:\n  " + string.Join("\n  ", failures.ToArray()));
        return passed;
    }

    // ---- signing helpers ---------------------------------------------------------

    static string Sign(byte[] data) { return Convert.ToBase64String(Ed25519.Sign(data, priv)); }

    static string Rel(string version, string file)
    {
        return "https://github.com/mistercr0wbar/HexShift/releases/download/v" + version + "/" + file;
    }

    static string J(string s)
    {
        if (s == null) return "null";
        return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t") + "\"";
    }

    // size is a raw JSON token, so a test can pass 123, "\"abc\"" or -5.
    static string Item(string version, string url, string signature, string size, string os, string channel, string description)
    {
        StringBuilder b = new StringBuilder("{\"version\":" + J(version) + ",\"url\":" + J(url));
        if (signature != null) b.Append(",\"signature\":" + J(signature));
        if (size != null) b.Append(",\"size\":" + size);
        if (os != null) b.Append(",\"os\":" + J(os));
        if (channel != null) b.Append(",\"channel\":" + J(channel));
        if (description != null) b.Append(",\"description\":" + J(description));
        return b.Append("}").ToString();
    }

    static readonly string FakeSignature = Convert.ToBase64String(new byte[64]);

    static string Good(string v)
    {
        return Item(v, Rel(v, "HexShift-" + v + "-Setup.exe"), FakeSignature, "1234567", "windows", "", "Notes for " + v);
    }

    static byte[] FeedOf(params string[] items)
    {
        return Encoding.UTF8.GetBytes("{\"title\":\"HexShift\",\"items\":[" + string.Join(",", items) + "]}");
    }

    static FeedResult Ev(byte[] feed, string current)
    {
        return UpdateFeed.Evaluate(feed, Sign(feed), pub, current, UpdatePolicy.IsInstallerAddress);
    }

    // ---- UpdatePolicy ------------------------------------------------------------

    static void PolicyChecks(string work)
    {
        string rel = "https://github.com/mistercr0wbar/HexShift/releases/download/";

        foreach (string u in new[] { "https://thecr0wbar.xyz/updates/hexshift/appcast.json", "https://thecr0wbar.xyz/updates/hexshift/appcast.json.signature", "https://THECR0WBAR.XYZ/updates/hexshift/appcast.json", "https://thecr0wbar.xyz:443/updates/hexshift/appcast.json" })
            Is(true, UpdatePolicy.IsFeedAddress(u), "feed ok " + u);
        foreach (string u in new[] { null, "", "not a url", "//thecr0wbar.xyz/updates/hexshift/appcast.json", "http://thecr0wbar.xyz/updates/hexshift/appcast.json", "https://thecr0wbar.xyz.evil.com/updates/hexshift/appcast.json", "https://evilthecr0wbar.xyz/updates/hexshift/appcast.json", "https://thecr0wbar.xyz:444/updates/hexshift/appcast.json", "https://user@thecr0wbar.xyz/updates/hexshift/appcast.json", "https://thecr0wbar.xyz\\@evil.com/updates/hexshift/appcast.json", "https://thecr0wbar.xyz/updates/hexshift/appcast.json?x=1", "https://thecr0wbar.xyz/updates/hexshift/appcast.json#x", "https://thecr0wbar.xyz/updates/hexshift/appcast.json/", "https://thecr0wbar.xyz/updates/hexshift/other.json", "https://thecr0wbar.xyz/", "file:///C:/Windows/win.ini", "ftp://thecr0wbar.xyz/updates/hexshift/appcast.json" })
            Is(false, UpdatePolicy.IsFeedAddress(u), "feed blocked " + u);
        Same("https://thecr0wbar.xyz/updates/hexshift/appcast.json", UpdatePolicy.FeedUrl, "feed url constant");

        foreach (string u in new[] { rel + "v2.1.0/appcast.json", rel + "v2.1.0/appcast.json.signature", rel + "v2.1.0/HexShift-2.1.0-Setup.exe", "https://github.com/mistercr0wbar/HexShift/releases/latest/download/appcast.json", "https://github.com/mistercr0wbar/HexShift/releases/latest/download/appcast.json.signature", "https://release-assets.githubusercontent.com/github-production-release-asset/1/x?sp=r&sig=abc", "https://objects.githubusercontent.com/x?y=1" })
            Is(true, UpdatePolicy.IsAllowedRedirect(u), "redirect ok " + u);
        foreach (string u in new[] { null, "", "https://github.com/mistercr0wbar/Other/releases/download/v2.1.0/appcast.json", rel + "v2.1.0/HexShift-2.2.0-Setup.exe", rel + "v2.1.0/HexShift.zip", rel + "v2.1.0/appcast.json?x=1", rel + "v2.1/appcast.json", rel + "2.1.0/appcast.json", rel + "v2.1.0/sub/appcast.json", "http://github.com/mistercr0wbar/HexShift/releases/download/v2.1.0/appcast.json", "https://github.com/mistercr0wbar/HexShift/releases/latest/download/HexShift-2.1.0-Setup.exe", "https://github.com/mistercr0wbar/HexShift/releases/latest/download/other.json", "https://user@github.com/mistercr0wbar/HexShift/releases/download/v2.1.0/appcast.json", "https://evilgithub.com/mistercr0wbar/HexShift/releases/download/v2.1.0/appcast.json", "https://github.com.evil.com/mistercr0wbar/HexShift/releases/download/v2.1.0/appcast.json", "https://githubusercontent.com/x", "https://raw.githubusercontent.com/x", "https://release-assets.githubusercontent.com.evil.com/x", "http://release-assets.githubusercontent.com/x", "https://release-assets.githubusercontent.com:8443/x", "https://thecr0wbar.xyz/updates/hexshift/appcast.json", "https://evil.com/x" })
            Is(false, UpdatePolicy.IsAllowedRedirect(u), "redirect blocked " + u);

        Is(true, UpdatePolicy.IsInstallerAddress(rel + "v2.1.0/HexShift-2.1.0-Setup.exe", "2.1.0"), "installer ok");
        Is(false, UpdatePolicy.IsInstallerAddress(rel + "v2.1.0/HexShift-2.1.0-Setup.exe", "2.2.0"), "installer version mismatch");
        Is(false, UpdatePolicy.IsInstallerAddress(rel + "v2.1.0/HexShift-2.2.0-Setup.exe", "2.2.0"), "installer file from a different release tag");
        Is(false, UpdatePolicy.IsInstallerAddress(rel + "v2.2.0/HexShift-2.1.0-Setup.exe", "2.1.0"), "installer tag newer than file");
        Is(false, UpdatePolicy.IsInstallerAddress(rel + "v2.1.0/HexShift-2.1.0-Setup.exe", "2.1"), "installer bad version");
        Is(false, UpdatePolicy.IsInstallerAddress(rel + "v2.1.0/HexShift-2.1.0-Setup.exe", null), "installer null version");
        Is(false, UpdatePolicy.IsInstallerAddress(rel + "v2.1.0/appcast.json", "2.1.0"), "installer wrong file");
        Is(false, UpdatePolicy.IsInstallerAddress("https://release-assets.githubusercontent.com/x", "2.1.0"), "installer CDN first hop");
        Is(false, UpdatePolicy.IsInstallerAddress("https://github.com/mistercr0wbar/HexShift/releases/latest/download/HexShift-2.1.0-Setup.exe", "2.1.0"), "installer via latest");
        Is(false, UpdatePolicy.IsInstallerAddress(null, "2.1.0"), "installer null url");

        foreach (string v in new[] { "2.1.0", "0.0.1", "10.20.30", "99999.0.0" }) Is(true, UpdatePolicy.IsVersion(v), "version ok " + v);
        foreach (string v in new[] { null, "", "2.1", "2.1.0.0", "2.1.0-beta", "v2.1.0", "02.1.0", "2.-1.0", "2..0", "123456.0.0", " 2.1.0", "2.1.0\n", "\uFF12.1.0", "2.1.x" })
            Is(false, UpdatePolicy.IsVersion(v), "version blocked [" + v + "]");

        Is(true, UpdatePolicy.IsNewer("2.1.0", "2.0.0"), "newer minor");
        Is(true, UpdatePolicy.IsNewer("2.0.1", "2.0.0"), "newer patch");
        Is(true, UpdatePolicy.IsNewer("2.10.0", "2.9.0"), "numeric not text order");
        Is(true, UpdatePolicy.IsNewer("3.0.0", "2.99.99"), "newer major");
        Is(false, UpdatePolicy.IsNewer("2.0.0", "2.0.0"), "equal is not newer");
        Is(false, UpdatePolicy.IsNewer("2.0.0", "2.1.0"), "older is not newer");
        Is(false, UpdatePolicy.IsNewer("bad", "2.0.0"), "bad candidate");
        Is(false, UpdatePolicy.IsNewer("2.1.0", "bad"), "bad current");
        Is(false, UpdatePolicy.IsNewer(null, null), "nulls");

        string folder = UpdatePolicy.StagingFolder(Path.Combine(work, "policy"));
        string name = "HexShift-2.1.0-Setup.exe";
        Is(true, UpdatePolicy.IsStagedInstaller(folder, Path.Combine(folder, name), "2.1.0"), "staged ok");
        Is(true, UpdatePolicy.IsStagedInstaller(folder + "\\", Path.Combine(folder, name), "2.1.0"), "staged ok trailing slash on folder");
        Is(false, UpdatePolicy.IsStagedInstaller(folder, Path.Combine(folder, name), "2.2.0"), "staged wrong version");
        Is(false, UpdatePolicy.IsStagedInstaller(folder, Path.Combine(folder, "other.exe"), "2.1.0"), "staged wrong name");
        Is(false, UpdatePolicy.IsStagedInstaller(folder, Path.Combine(folder, "sub", name), "2.1.0"), "staged in subfolder");
        Is(false, UpdatePolicy.IsStagedInstaller(folder, folder + "\\..\\" + name, "2.1.0"), "staged via ..");
        Is(false, UpdatePolicy.IsStagedInstaller(folder, folder + "2\\" + name, "2.1.0"), "staged sibling folder");
        Is(false, UpdatePolicy.IsStagedInstaller(folder, Path.Combine(folder, name) + ":evil", "2.1.0"), "staged alternate stream");
        Is(false, UpdatePolicy.IsStagedInstaller(folder, "\\\\server\\share\\" + name, "2.1.0"), "staged UNC");
        Is(false, UpdatePolicy.IsStagedInstaller(folder, null, "2.1.0"), "staged null path");
        Is(false, UpdatePolicy.IsStagedInstaller(folder, "", "2.1.0"), "staged empty path");
        Is(false, UpdatePolicy.IsStagedInstaller(null, Path.Combine(folder, name), "2.1.0"), "staged null folder");
        Is(false, UpdatePolicy.IsStagedInstaller(folder, Path.Combine(folder, name), null), "staged null version");

        DateTime now = new DateTime(2026, 10, 22, 12, 0, 0, DateTimeKind.Utc);
        Is(true, UpdatePolicy.IsCheckDue(true, DateTime.MinValue, now), "check due: never checked");
        Is(true, UpdatePolicy.IsCheckDue(true, now.AddHours(-24), now), "check due: exactly 24h");
        Is(true, UpdatePolicy.IsCheckDue(true, now.AddDays(-3), now), "check due: days ago");
        Is(false, UpdatePolicy.IsCheckDue(true, now.AddHours(-23), now), "check not due: 23h");
        Is(false, UpdatePolicy.IsCheckDue(true, now.AddMinutes(-1), now), "check not due: a minute ago");
        Is(true, UpdatePolicy.IsCheckDue(true, now.AddHours(5), now), "check due: last check in the future (clock changed)");
        Is(false, UpdatePolicy.IsCheckDue(false, DateTime.MinValue, now), "check never due when automatic checks are off");

        Same("/SP- /SILENT /NORESTART /CLOSEAPPLICATIONS /NORESTARTAPPLICATIONS /RESTARTEXITCODE=3010", UpdatePolicy.InstallerArguments, "fixed installer switches");

        // Program.Version and the EXE's file version are two places that must agree; the installer
        // script refuses to build if they do not.
        string product = FileVersionInfo.GetVersionInfo(typeof(Program).Assembly.Location).ProductVersion;
        Same(Program.Version, product.Split('+')[0], "Program.Version matches the built EXE's product version");
    }

    // ---- keys and signatures -----------------------------------------------------

    static void KeyChecks()
    {
        byte[] data = new byte[] { 1, 2, 3, 4, 5 };
        string sig = Sign(data);
        Is(true, UpdateFeed.Verifies(sig, data, pub), "verifies a good signature");
        Is(true, UpdateFeed.Verifies("  " + sig + "\r\n", data, pub), "verifies a signature with surrounding whitespace");
        Is(false, UpdateFeed.Verifies(sig, new byte[] { 1, 2, 3, 4, 6 }, pub), "rejects changed data");
        Is(false, UpdateFeed.Verifies(sig, data, otherPub), "rejects another key");
        Is(false, UpdateFeed.Verifies(sig, data, null), "rejects a null key");
        Is(false, UpdateFeed.Verifies(sig, data, new byte[31]), "rejects a short key");
        Is(false, UpdateFeed.Verifies(sig, null, pub), "rejects null data");
        Is(false, UpdateFeed.Verifies(null, data, pub), "rejects a null signature");
        Is(false, UpdateFeed.Verifies("", data, pub), "rejects an empty signature");
        Is(false, UpdateFeed.Verifies("not base64!!", data, pub), "rejects non-base64");
        Is(false, UpdateFeed.Verifies(Convert.ToBase64String(new byte[63]), data, pub), "rejects a 63-byte signature");
        Is(false, UpdateFeed.Verifies(Convert.ToBase64String(new byte[65]), data, pub), "rejects a 65-byte signature");
        Is(false, UpdateFeed.Verifies(new string('A', 400), data, pub), "rejects an oversized signature text");
        byte[] flipped = Ed25519.Sign(data, priv);
        flipped[10] ^= 1;
        Is(false, UpdateFeed.Verifies(Convert.ToBase64String(flipped), data, pub), "rejects a signature with one flipped bit");

        string key = Convert.ToBase64String(pub);
        Is(true, UpdateFeed.ParsePublicKey(key) != null, "public key parses");
        Is(true, UpdateFeed.ParsePublicKey(key + "\r\n") != null, "public key parses with a trailing newline");
        Is(false, UpdateFeed.ParsePublicKey("NOT-SET") != null, "the placeholder key switches updates off");
        Is(false, UpdateFeed.ParsePublicKey(null) != null, "null key");
        Is(false, UpdateFeed.ParsePublicKey("") != null, "empty key");
        Is(false, UpdateFeed.ParsePublicKey(key.Substring(1)) != null, "43-character key");
        Is(false, UpdateFeed.ParsePublicKey(Convert.ToBase64String(new byte[33])) != null, "33-byte key");
        Is(false, UpdateFeed.ParsePublicKey(new string('!', 44)) != null, "44 characters of non-base64");
    }

    // ---- the feed ----------------------------------------------------------------

    static void FeedChecks()
    {
        FeedResult r = Ev(FeedOf(Good("2.1.1")), "2.1.0");
        Is(true, r.Status == FeedStatus.Available, "newer version is available");
        Same("2.1.1", r.Offer == null ? null : r.Offer.Version, "offer version");
        Same(Rel("2.1.1", "HexShift-2.1.1-Setup.exe"), r.Offer == null ? null : r.Offer.Url, "offer url");
        Same("1234567", r.Offer == null ? null : r.Offer.Size.ToString(), "offer size");
        Same("Notes for 2.1.1", r.Offer == null ? null : r.Offer.Notes, "offer notes");

        Is(true, Ev(FeedOf(Good("2.1.0")), "2.1.0").Status == FeedStatus.UpToDate, "same version is up to date");
        Is(true, Ev(FeedOf(Good("2.0.9")), "2.1.0").Status == FeedStatus.UpToDate, "older version is up to date");
        Is(true, Ev(FeedOf(), "2.1.0").Status == FeedStatus.UpToDate, "empty list is up to date");

        r = Ev(FeedOf(Good("2.1.1"), Good("2.3.0"), Good("2.2.0")), "2.1.0");
        Same("2.3.0", r.Offer == null ? null : r.Offer.Version, "the highest newer version wins");
        r = Ev(FeedOf(Good("2.9.0"), Good("2.1.1")), "2.1.0");
        Same("2.9.0", r.Offer == null ? null : r.Offer.Version, "order in the feed does not matter");

        // signature and shape
        byte[] good = FeedOf(Good("2.1.1"));
        Is(true, UpdateFeed.Evaluate(good, Sign(good), otherPub, "2.1.0", UpdatePolicy.IsInstallerAddress).Status == FeedStatus.Rejected, "feed signed for another key is rejected");
        Is(true, UpdateFeed.Evaluate(good, null, pub, "2.1.0", UpdatePolicy.IsInstallerAddress).Status == FeedStatus.Rejected, "feed with no signature is rejected");
        Is(true, UpdateFeed.Evaluate(good, "", pub, "2.1.0", UpdatePolicy.IsInstallerAddress).Status == FeedStatus.Rejected, "feed with an empty signature is rejected");
        Is(true, UpdateFeed.Evaluate(good, Sign(good), null, "2.1.0", UpdatePolicy.IsInstallerAddress).Status == FeedStatus.Rejected, "no public key rejects everything");
        byte[] tampered = (byte[])good.Clone();
        tampered[tampered.Length - 5] ^= 1;
        Is(true, UpdateFeed.Evaluate(tampered, Sign(good), pub, "2.1.0", UpdatePolicy.IsInstallerAddress).Status == FeedStatus.Rejected, "a feed changed after signing is rejected");
        Is(true, UpdateFeed.Evaluate(null, Sign(good), pub, "2.1.0", UpdatePolicy.IsInstallerAddress).Status == FeedStatus.Rejected, "null feed");
        Is(true, UpdateFeed.Evaluate(new byte[0], Sign(new byte[0]), pub, "2.1.0", UpdatePolicy.IsInstallerAddress).Status == FeedStatus.Rejected, "empty feed");
        byte[] huge = new byte[UpdatePolicy.MaxFeedBytes + 1];
        Is(true, UpdateFeed.Evaluate(huge, Sign(huge), pub, "2.1.0", UpdatePolicy.IsInstallerAddress).Status == FeedStatus.Rejected, "oversized feed is rejected even when signed");
        Is(true, UpdateFeed.Evaluate(good, Sign(good), pub, "not a version", UpdatePolicy.IsInstallerAddress).Status == FeedStatus.Rejected, "a bad current version is rejected");

        // signed but not usable (an attacker with the key would still be held to the rules)
        Is(true, Ev(Encoding.UTF8.GetBytes("{not json"), "2.1.0").Status == FeedStatus.Rejected, "malformed JSON");
        Is(true, Ev(Encoding.UTF8.GetBytes("[1,2,3]"), "2.1.0").Status == FeedStatus.Rejected, "top level is not an object");
        Is(true, Ev(Encoding.UTF8.GetBytes("{\"items\":\"nope\"}"), "2.1.0").Status == FeedStatus.Rejected, "items is not a list");
        Is(true, Ev(Encoding.UTF8.GetBytes("{\"title\":\"x\"}"), "2.1.0").Status == FeedStatus.Rejected, "no items at all");
        byte[] bom = new byte[] { 0xEF, 0xBB, 0xBF };
        byte[] withBom = new byte[bom.Length + good.Length];
        Buffer.BlockCopy(bom, 0, withBom, 0, bom.Length);
        Buffer.BlockCopy(good, 0, withBom, bom.Length, good.Length);
        Is(true, Ev(withBom, "2.1.0").Status == FeedStatus.Rejected, "a feed starting with a byte-order mark");
        byte[] badUtf8 = new byte[] { (byte)'{', 0xFF, 0xFE, (byte)'}' };
        Is(true, Ev(badUtf8, "2.1.0").Status == FeedStatus.Rejected, "invalid UTF-8");
        Is(true, Ev(Encoding.UTF8.GetBytes("{\"items\":[1,\"two\",null," + Good("2.1.1") + "]}"), "2.1.0").Status == FeedStatus.Available, "entries that are not objects are skipped");

        // entries that cannot be offered
        string v = "2.1.1";
        string okUrl = Rel(v, "HexShift-" + v + "-Setup.exe");
        Is(true, Ev(FeedOf(Item(v, "https://evil.example/HexShift-2.1.1-Setup.exe", FakeSignature, "100", "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "download on another host");
        Is(true, Ev(FeedOf(Item(v, "http://github.com/mistercr0wbar/HexShift/releases/download/v2.1.1/HexShift-2.1.1-Setup.exe", FakeSignature, "100", "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "download over plain http");
        Is(true, Ev(FeedOf(Item(v, Rel("2.2.0", "HexShift-2.2.0-Setup.exe"), FakeSignature, "100", "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "download address for a different version");
        Is(true, Ev(FeedOf(Item(v, null, FakeSignature, "100", "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "no download address");
        Is(true, Ev(FeedOf(Item(v, okUrl, null, "100", "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "no installer signature");
        Is(true, Ev(FeedOf(Item(v, okUrl, "AAAA", "100", "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "installer signature of the wrong length");
        Is(true, Ev(FeedOf(Item(v, okUrl, "!!!!", "100", "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "installer signature that is not base64");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, null, "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "no size");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, "0", "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "size zero");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, "-5", "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "negative size");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, "\"100\"", "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "size given as text");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, "true", "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "size given as a boolean");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, (UpdatePolicy.MaxInstallerBytes + 1).ToString(), "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "size one byte over the ceiling");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, UpdatePolicy.MaxInstallerBytes.ToString(), "windows", "", "")), "2.1.0").Status == FeedStatus.Available, "size exactly at the ceiling");
        Is(true, Ev(FeedOf(Good("2.1.1"), Item("2.2.0", "https://evil.example/x.exe", FakeSignature, "100", "windows", "", "")), "2.1.0").Status == FeedStatus.Available, "a valid newer entry still wins over an invalid sibling");
        Is(true, Ev(FeedOf(Good("2.0.5"), Item("2.2.0", "https://evil.example/x.exe", FakeSignature, "100", "windows", "", "")), "2.1.0").Status == FeedStatus.Rejected, "only an invalid newer entry is reported, not hidden");

        // other systems and channels are ignored, not errors
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, "100", "darwin", "", "")), "2.1.0").Status == FeedStatus.UpToDate, "'darwin' contains 'win' but is not Windows");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, "100", "linux", "", "")), "2.1.0").Status == FeedStatus.UpToDate, "linux entry ignored");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, "100", "macos", "", "")), "2.1.0").Status == FeedStatus.UpToDate, "mac entry ignored");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, "100", "windows", "beta", "")), "2.1.0").Status == FeedStatus.UpToDate, "beta channel ignored");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, "100", "win-x64", "", "")), "2.1.0").Status == FeedStatus.Available, "win-x64 accepted");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, "100", "WINDOWS", null, "")), "2.1.0").Status == FeedStatus.Available, "upper-case os, no channel accepted");
        Is(true, Ev(FeedOf(Item(v, okUrl, FakeSignature, "100", null, null, "")), "2.1.0").Status == FeedStatus.Available, "no os field means Windows");

        // release notes are plain, short text
        r = Ev(FeedOf(Item(v, okUrl, FakeSignature, "100", "windows", "", "a\u0001b\u0007c\td\ne")), "2.1.0");
        Same("abc\td\ne", r.Offer == null ? null : r.Offer.Notes, "control characters are dropped from notes");
        r = Ev(FeedOf(Item(v, okUrl, FakeSignature, "100", "windows", "", new string('x', 5000))), "2.1.0");
        Same("4000", r.Offer == null ? null : r.Offer.Notes.Length.ToString(), "notes are cut to 4000 characters");
        r = Ev(FeedOf(Item(v, okUrl, FakeSignature, "100", "windows", "", null)), "2.1.0");
        Same("", r.Offer == null ? null : r.Offer.Notes, "missing notes become empty text");
        r = Ev(FeedOf(Item(v, okUrl, FakeSignature, "100", "windows", "", "<script>alert(1)</script>")), "2.1.0");
        Same("<script>alert(1)</script>", r.Offer == null ? null : r.Offer.Notes, "markup in notes is kept as text, never interpreted");
    }

    // ---- saved preferences -------------------------------------------------------

    static void SettingsChecks(string work)
    {
        string dir = Path.Combine(work, "settings");
        Directory.CreateDirectory(dir);
        string file = Path.Combine(dir, "update-settings.json");

        UpdateSettings s = UpdateSettings.Load(dir);
        Is(true, s.AutoCheck, "default: automatic checks on");
        Is(true, s.LastCheckUtc == DateTime.MinValue, "default: never checked");

        s.AutoCheck = false;
        s.LastCheckUtc = new DateTime(2026, 10, 21, 8, 30, 0, DateTimeKind.Utc);
        s.Save(dir);
        Is(true, File.Exists(file), "settings file written");
        Is(true, Directory.GetFiles(dir, "*.tmp").Length == 0, "no temporary file left behind");
        UpdateSettings back = UpdateSettings.Load(dir);
        Is(false, back.AutoCheck, "automatic-check choice survives a restart");
        Is(true, back.LastCheckUtc == s.LastCheckUtc, "last check time survives a restart");
        back.AutoCheck = true;
        back.Save(dir);
        Is(true, UpdateSettings.Load(dir).AutoCheck, "saving over an existing file works");

        File.WriteAllText(file, "{{{ not json");
        Is(true, UpdateSettings.Load(dir).AutoCheck, "garbage file gives defaults");
        File.WriteAllText(file, "{\"autoCheck\":\"no\",\"lastCheckUtc\":12345}");
        UpdateSettings wrong = UpdateSettings.Load(dir);
        Is(true, wrong.AutoCheck && wrong.LastCheckUtc == DateTime.MinValue, "wrong value types give defaults");
        File.WriteAllText(file, "{\"autoCheck\":false,\"pad\":\"" + new string('x', 5000) + "\"}");
        Is(true, UpdateSettings.Load(dir).AutoCheck, "an oversized file is ignored, not read");
        File.WriteAllText(file, "[1,2,3]");
        Is(true, UpdateSettings.Load(dir).AutoCheck, "wrong top-level shape gives defaults");
        Is(true, UpdateSettings.Load(Path.Combine(work, "does-not-exist")).AutoCheck, "missing folder gives defaults");
    }
}
