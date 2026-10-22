// Release gate: checks the exact files a release is about to publish, with the exact
// update code that ships in HexShift.exe, before anything goes public.
//
//   HostTests.exe verify-release --feed appcast.json --signature appcast.json.signature
//                 --key app/update-public-key.txt --exe dist/HexShift.exe
//                 --installer HexShift-2.1.1-Setup.exe --tag v2.1.1
//
// Exit code 0 only if a copy of HexShift older than this release would be offered it, the
// feed and installer signatures verify against the key built into the app, and the tag, the
// installer's file name, its embedded version, the download address and the size all agree.
// Prints one "ok" or "FAIL" line per check. Reads files only; never touches the network.
//
// C# 5, like the host.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using HexShift;

// Runs inside the throwaway app domain used by ReleaseCheck.EmbeddedKeyText.
public sealed class KeyProbe : MarshalByRefObject
{
    public string Read(string exePath)
    {
        Assembly assembly = Assembly.ReflectionOnlyLoadFrom(exePath);
        using (Stream stream = assembly.GetManifestResourceStream("UpdatePublicKey.txt"))
        {
            if (stream == null) return null;
            using (StreamReader reader = new StreamReader(stream, Encoding.ASCII)) return reader.ReadToEnd();
        }
    }
}

static class ReleaseCheck
{
    static int failed;

    static void Is(bool ok, string label)
    {
        Console.WriteLine((ok ? "ok    " : "FAIL  ") + label);
        if (!ok) failed++;
    }

    internal static int Run(string[] argv)
    {
        failed = 0;
        Dictionary<string, string> options = new Dictionary<string, string>();
        for (int i = 1; i + 1 < argv.Length; i += 2) options[argv[i]] = argv[i + 1];
        string[] required = new[] { "--feed", "--signature", "--key", "--installer", "--tag", "--exe" };
        foreach (string name in required)
        {
            if (!options.ContainsKey(name)) { Console.WriteLine("FAIL  missing " + name); return 2; }
        }

        string tag = options["--tag"];
        string version = tag.StartsWith("v", StringComparison.Ordinal) ? tag.Substring(1) : tag;
        Is(UpdatePolicy.IsVersion(version) && tag == "v" + version, "the tag is v + a plain major.minor.patch version: " + tag);
        string installerName = Path.GetFileName(options["--installer"]);
        Is(UpdatePolicy.IsInstallerFileName(installerName, version), "the installer's file name is HexShift-" + version + "-Setup.exe: " + installerName);
        string product = FileVersionInfo.GetVersionInfo(Path.GetFullPath(options["--installer"])).ProductVersion;
        string embedded = (product ?? "").Split('+')[0].Trim();
        // The generator reads this value, so it must equal the tag (a trailing .0 is dropped by the tool).
        Is(embedded == version || embedded == version + ".0", "the installer's embedded product version equals the tag: " + embedded);

        byte[] key = UpdateFeed.ParsePublicKey(File.ReadAllText(options["--key"]));
        Is(key != null, "the public key in " + options["--key"] + " is a real 32-byte key (not the NOT-SET placeholder)");
        if (key == null) return Finish();

        // The key that matters is the one built INTO the EXE users will run, not the text file next to it.
        string exe = Path.GetFullPath(options["--exe"]);
        string embeddedKey = EmbeddedKeyText(exe);
        Is(embeddedKey != null && embeddedKey.Trim() == File.ReadAllText(options["--key"]).Trim(), "the public key built into " + options["--exe"] + " equals " + options["--key"]);
        string exeProduct = (FileVersionInfo.GetVersionInfo(exe).ProductVersion ?? "").Split('+')[0].Trim();
        Is(exeProduct == version, "the shipped EXE's version equals the tag: " + exeProduct);

        byte[] feed = File.ReadAllBytes(options["--feed"]);
        string signature = File.ReadAllText(options["--signature"]);
        byte[] installer = File.ReadAllBytes(options["--installer"]);
        Is(feed.Length > 0 && feed.Length <= UpdatePolicy.MaxFeedBytes, "the feed is within " + UpdatePolicy.MaxFeedBytes + " bytes: " + feed.Length);
        Is(!(feed.Length >= 3 && feed[0] == 0xEF && feed[1] == 0xBB && feed[2] == 0xBF), "the feed has no byte-order mark");
        Is(signature.Trim().Length > 0 && signature.Trim().Length < 200, "the signature file holds one short line of base64");
        Is(installer.Length > 0 && installer.Length <= UpdatePolicy.MaxInstallerBytes, "the installer is within " + UpdatePolicy.MaxInstallerBytes + " bytes: " + installer.Length);
        Is(UpdateFeed.Verifies(signature, feed, key), "the feed's signature verifies against the app's public key");

        // Any copy older than this release must be offered exactly this release.
        FeedResult result = UpdateFeed.Evaluate(feed, signature, key, "0.0.0", UpdatePolicy.IsInstallerAddress);
        Is(result.Status == FeedStatus.Available, "an older copy of HexShift is offered an update (" + result.Status + (result.Reason == null ? "" : ": " + result.Reason) + ")");
        if (result.Offer != null)
        {
            Is(result.Offer.Version == version, "the offered version is " + version + ": " + result.Offer.Version);
            string expectedUrl = "https://github.com/mistercr0wbar/HexShift/releases/download/v" + version + "/" + installerName;
            Is(result.Offer.Url == expectedUrl, "the download address is " + expectedUrl);
            Is(result.Offer.Size == installer.Length, "the announced size equals the installer's: " + result.Offer.Size + " vs " + installer.Length);
            Is(UpdateFeed.Verifies(result.Offer.Signature, installer, key), "the installer's signature verifies against the app's public key");
        }
        // A copy already on this release must see nothing newer, so the feed holds no later entry by mistake.
        Is(UpdateFeed.Evaluate(feed, signature, key, version, UpdatePolicy.IsInstallerAddress).Status == FeedStatus.UpToDate, "a copy already on " + version + " sees no update");
        return Finish();
    }

    // The UpdatePublicKey.txt resource of an EXE, read without running it. The EXE is opened
    // reflection-only inside a throwaway app domain that is unloaded straight after, so the file
    // is released again (an assembly cannot be unloaded from the main domain).
    static string EmbeddedKeyText(string exePath)
    {
        AppDomain domain = null;
        try
        {
            domain = AppDomain.CreateDomain("hexshift-key-probe");
            KeyProbe probe = (KeyProbe)domain.CreateInstanceAndUnwrap(typeof(KeyProbe).Assembly.FullName, typeof(KeyProbe).FullName);
            return probe.Read(exePath);
        }
        catch (Exception) { return null; }
        finally
        {
            if (domain != null) { try { AppDomain.Unload(domain); } catch (Exception) { } }
        }
    }

    static int Finish()
    {
        Console.WriteLine(failed == 0 ? "RELEASE CHECK PASSED" : failed + " RELEASE CHECK(S) FAILED");
        return failed == 0 ? 0 : 1;
    }
}
