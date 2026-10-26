// Checks added after review of the updater: what the release build actually does with the
// real addresses, refusing assemblies planted beside the EXE, the open-file location check,
// the Windows locking behaviour the design relies on, concurrent saves of the preferences,
// and the release gate run end to end on stand-in artifacts.
//
// C# 5, like the host.

using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using Microsoft.CSharp;
using HexShift;

static partial class UpdateTests
{
    static void HardeningChecks(string work)
    {
        ProductionRouteChecks();
        SideBySideChecks(work);
        FinalPathChecks(work);
        SettingsRaceChecks(work);
        ReleaseGateChecks(work);
    }

    // ---- the release build's real routes ----------------------------------------

    static void ProductionRouteChecks()
    {
        UpdateEndpoints release = UpdateEndpoints.Release();
        UpdateRoute feed = release.ForFeed();
        Is(true, feed.First(UpdatePolicy.FeedUrl) && feed.First(UpdatePolicy.FeedUrl + ".signature"), "the release feed route starts at the site's two stable addresses");
        Is(false, feed.First("https://github.com/mistercr0wbar/HexShift/releases/latest/download/appcast.json"), "...and not at GitHub directly");

        // The feed's real chain: the site, GitHub's "latest" address, the release's own file, the CDN.
        string[] hops = new[]
        {
            "https://github.com/mistercr0wbar/HexShift/releases/latest/download/appcast.json",
            "https://github.com/mistercr0wbar/HexShift/releases/download/v2.1.0/appcast.json",
            "https://release-assets.githubusercontent.com/github-production-release-asset/1/x?sp=r&sig=abc"
        };
        foreach (string hop in hops) Is(true, feed.Redirect(hop), "the real feed chain is allowed: " + hop);
        Is(true, feed.MaxRedirects >= hops.Length + 1, "the feed's redirect budget (" + feed.MaxRedirects + ") covers its real " + hops.Length + "-redirect chain with a spare");

        UpdateRoute installer = release.ForInstaller("2.1.0");
        string installerUrl = Rel("2.1.0", "HexShift-2.1.0-Setup.exe");
        Is(true, installer.First(installerUrl), "the installer route starts at that version's release file");
        Is(false, installer.First(Rel("2.1.1", "HexShift-2.1.1-Setup.exe")), "...and at no other version's file");
        Is(true, installer.Redirect(hops[2]), "an installer may be redirected to the CDN");
        Is(false, installer.Redirect(hops[0]), "...but not through the latest address");
        Is(false, installer.Redirect(hops[1]), "...nor to another release file on github.com");
        Is(true, installer.MaxRedirects >= 2 && installer.MaxRedirects <= 3, "the installer's redirect budget is one expected hop plus a spare: " + installer.MaxRedirects);
        Is(true, feed.Deadline > TimeSpan.Zero && feed.Deadline <= TimeSpan.FromMinutes(5), "the feed has an overall deadline: " + feed.Deadline);
        Is(true, installer.Deadline > feed.Deadline && installer.Deadline <= TimeSpan.FromHours(2), "the installer has a longer overall deadline: " + installer.Deadline);

        // addresses that look close but must stay refused (the safe outcome pinned, so a change is noticed)
        Is(false, UpdatePolicy.IsFeedAddress("https://thecr0wbar.xyz./updates/hexshift/appcast.json"), "feed: a trailing dot on the host");
        Is(false, UpdatePolicy.IsFeedAddress("https://thecr0wbar.xyz/UPDATES/hexshift/appcast.json"), "feed: different case in the path");
        Is(false, UpdatePolicy.IsFeedAddress("https://104.21.0.1/updates/hexshift/appcast.json"), "feed: an IPv4 address");
        Is(false, UpdatePolicy.IsFeedAddress("https://[::1]/updates/hexshift/appcast.json"), "feed: an IPv6 address");
        Is(false, UpdatePolicy.IsFeedAddress("https://thecr0wbar.xyz/updates/hexshift/../hexshift/other.json"), "feed: a dot-segment that lands somewhere else");
        Is(false, UpdatePolicy.IsAllowedRedirect("https://github.com/MisterCr0wBar/HexShift/releases/download/v2.1.0/appcast.json"), "redirect: different case in the owner");
        Is(false, UpdatePolicy.IsAllowedRedirect("https://github.com./mistercr0wbar/HexShift/releases/download/v2.1.0/appcast.json"), "redirect: a trailing dot on the host");
        Is(false, UpdatePolicy.IsAllowedRedirect("https://140.82.112.3/mistercr0wbar/HexShift/releases/download/v2.1.0/appcast.json"), "redirect: an IPv4 address for github.com");
        Is(false, UpdatePolicy.IsAllowedRedirect("https://github.com/mistercr0wbar/HexShift/releases/download/v2.1.0/../../../../Other/releases/download/v2.1.0/appcast.json"), "redirect: a dot-segment walk into another repository");
        Is(false, UpdatePolicy.IsAllowedRedirect("https://github.com/mistercr0wbar/HexShift/releases/download/v2.1.0/%2e%2e/%2e%2e/Other/appcast.json"), "redirect: encoded dot-segments");
        Is(false, UpdatePolicy.IsAllowedRedirect("https://release-assets.githubusercontent.com./x"), "redirect: a trailing dot on the CDN host");
        Is(false, UpdatePolicy.IsInstallerRedirect("https://github.com/mistercr0wbar/HexShift/releases/download/v2.1.0/HexShift-2.1.0-Setup.exe"), "installer redirect: github.com itself");
        Is(false, UpdatePolicy.IsInstallerRedirect("http://release-assets.githubusercontent.com/x"), "installer redirect: plain http to the CDN");
        Is(false, UpdatePolicy.IsInstallerRedirect(null), "installer redirect: nothing");
        Is(false, UpdatePolicy.IsInstallerAddress(Rel("2.1.0", "HexShift-2.1.0-Setup.exe").Replace("/v2.1.0/", "/v2.1.0/../v2.1.0/x/"), "2.1.0"), "installer: a path that wanders");
    }

    // ---- planted assemblies ------------------------------------------------------

    static void SideBySideChecks(string work)
    {
        string dir = Path.Combine(work, "sidebyside");
        Directory.CreateDirectory(dir);
        string exe = Path.Combine(dir, "HexShift.exe");
        File.WriteAllText(Path.Combine(dir, "other.dll"), "x");
        File.WriteAllText(Path.Combine(dir, "readme.txt"), "x");
        try { Program.RejectSideBySideAssemblies(exe); Is(true, true, "an EXE with only unrelated files beside it starts"); }
        catch (IOException ex) { Is(true, false, "unrelated files must not stop startup: " + ex.Message); }

        foreach (string name in Program.EmbeddedAssemblies)
        {
            foreach (string where in new[] { name + ".dll", name + ".exe", Path.Combine(name, name + ".dll"), Path.Combine(name, name + ".exe") })
            {
                string planted = Path.Combine(dir, where);
                Directory.CreateDirectory(Path.GetDirectoryName(planted));
                File.WriteAllText(planted, "x");
                Raises<IOException>(delegate { Program.RejectSideBySideAssemblies(exe); }, "startup is refused when " + where + " sits beside the EXE");
                File.Delete(planted);
                if (Path.GetDirectoryName(where).Length > 0) Directory.Delete(Path.Combine(dir, Path.GetDirectoryName(where)));
            }
        }
        File.WriteAllText(exe + ".config", "<configuration/>");
        Raises<IOException>(delegate { Program.RejectSideBySideAssemblies(exe); }, "startup is refused when a .config file sits beside the EXE");
        File.Delete(exe + ".config");
        Is(true, Program.EmbeddedAssemblies.Length == 3, "exactly the three embedded assemblies are guarded");
        Is(true, Array.IndexOf(Program.EmbeddedAssemblies, "Chaos.NaCl") >= 0, "the Ed25519 assembly is among the guarded ones");
    }

    static void Is(int expected, int actual, string label)
    {
        Is(true, expected == actual, label + " (" + actual + ")");
    }

    // ---- where an open file really is, and what Windows lets others do to it -----

    static void FinalPathChecks(string work)
    {
        string real = Path.Combine(work, "finalpath", "real");
        Directory.CreateDirectory(real);
        string file = Path.Combine(real, "a.bin");
        File.WriteAllBytes(file, new byte[] { 1, 2, 3 });

        using (FileStream held = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            Is(true, UpdateInstaller.IsAt(held, file), "an open file is found at its own path");
            Is(true, UpdateInstaller.IsAt(held, Path.Combine(real, "..", "real", "a.bin")), "...also when the expected path wanders and comes back");
            Is(false, UpdateInstaller.IsAt(held, Path.Combine(work, "finalpath", "elsewhere", "a.bin")), "...and not at a different path");

            // What the design relies on: while the installer is held open this way, nobody else can
            // change it, delete it, or move the folder it sits in. If a Windows version ever behaved
            // differently, these would fail and say so.
            Raises<IOException>(delegate { File.WriteAllBytes(file, new byte[] { 9 }); }, "a file held open for reading cannot be rewritten");
            Raises<IOException>(delegate { File.Delete(file); }, "a file held open for reading cannot be deleted");
            Raises<IOException>(delegate { File.Move(file, file + ".moved"); }, "a file held open for reading cannot be renamed");
            Raises<IOException>(delegate { Directory.Move(real, real + "-moved"); }, "the folder holding an open file cannot be renamed");
            Is(true, File.Exists(file) && Directory.Exists(real), "nothing moved");
        }

        // a folder junction: the same file reached through a link is NOT at the path that goes through the link
        string link = Path.Combine(work, "finalpath", "link");
        ProcessStartInfo info = new ProcessStartInfo("cmd.exe", "/c mklink /J \"" + link + "\" \"" + real + "\"");
        info.CreateNoWindow = true;
        info.UseShellExecute = false;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        using (Process cmd = Process.Start(info)) { cmd.StandardOutput.ReadToEnd(); cmd.StandardError.ReadToEnd(); cmd.WaitForExit(); }
        if (Directory.Exists(link))
        {
            string viaLink = Path.Combine(link, "a.bin");
            using (FileStream held = new FileStream(viaLink, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                Is(false, UpdateInstaller.IsAt(held, viaLink), "a file opened through a folder junction is not at the path that names the junction");
                Is(true, UpdateInstaller.IsAt(held, file), "...it is really in the junction's target");
            }
            Raises<IOException>(delegate { Program.RejectRedirects(viaLink); }, "a path through a junction is refused by the redirect check too");
            Directory.Delete(link); // removes the junction only, never its target
            Is(true, File.Exists(file), "removing the junction left its target alone");
        }
    }

    // ---- two saves at once --------------------------------------------------------

    static void SettingsRaceChecks(string work)
    {
        string dir = Path.Combine(work, "settings-race");
        Directory.CreateDirectory(dir);
        UpdateSettings shared = UpdateSettings.Load(dir);
        int wrong = 0;
        for (int round = 0; round < 200; round++)
        {
            // A background save (as after a successful check) runs in a loop while the user switches
            // automatic checks off and that choice is saved. Once the background saver has stopped, the
            // file must say "off": a save that read the old value must not be able to land last.
            bool stop = false;
            Thread background = new Thread(delegate() { while (!stop) shared.Save(dir); });
            background.IsBackground = true;
            shared.AutoCheck = true;
            background.Start();
            Thread.Sleep(1);
            shared.AutoCheck = false;
            shared.Save(dir);
            stop = true;
            background.Join();
            if (UpdateSettings.Load(dir).AutoCheck) wrong++;
        }
        Is(0, wrong, "a background save never undoes the user's switch-off (rounds where it did)");
    }

    // ---- the release gate, end to end ---------------------------------------------

    static void BuildExe(string path, string version, string keyText)
    {
        string dir = Path.GetDirectoryName(path);
        Directory.CreateDirectory(dir);
        using (CSharpCodeProvider provider = new CSharpCodeProvider())
        {
            CompilerParameters options = new CompilerParameters();
            options.GenerateExecutable = true;
            options.OutputAssembly = path;
            options.CompilerOptions = "/nologo";
            if (keyText != null)
            {
                string keyFile = Path.Combine(dir, "UpdatePublicKey.txt");
                File.WriteAllText(keyFile, keyText);
                options.EmbeddedResources.Add(keyFile);
            }
            string source = "using System.Reflection; [assembly: AssemblyVersion(\"" + version + ".0\")] [assembly: AssemblyFileVersion(\"" + version + ".0\")] [assembly: AssemblyInformationalVersion(\"" + version + "\")] static class P { static void Main() { } }";
            CompilerResults result = provider.CompileAssemblyFromSource(options, source);
            if (result.Errors.HasErrors) throw new Exception("Could not build a stand-in EXE: " + result.Errors[0].ErrorText);
        }
    }

    static int RunGate(string[] args, out string output)
    {
        TextWriter original = Console.Out;
        StringWriter captured = new StringWriter();
        Console.SetOut(captured);
        try { int exit = ReleaseCheck.Run(args); output = captured.ToString(); return exit; }
        finally { Console.SetOut(original); }
    }

    static string[] GateArgs(string feed, string signature, string key, string exe, string installer, string tag)
    {
        return new[] { "verify-release", "--feed", feed, "--signature", signature, "--key", key, "--exe", exe, "--installer", installer, "--tag", tag };
    }

    static void ReleaseGateChecks(string work)
    {
        string dir = Path.Combine(work, "gate");
        Directory.CreateDirectory(dir);
        string keyText = Convert.ToBase64String(pub);
        string keyFile = Path.Combine(dir, "update-public-key.txt");
        File.WriteAllText(keyFile, keyText + "\n");

        string goodExe = Path.Combine(dir, "good", "HexShift.exe");
        BuildExe(goodExe, "2.1.1", keyText);
        string otherKeyExe = Path.Combine(dir, "otherkey", "HexShift.exe");
        BuildExe(otherKeyExe, "2.1.1", Convert.ToBase64String(otherPub));
        string noKeyExe = Path.Combine(dir, "notset", "HexShift.exe");
        BuildExe(noKeyExe, "2.1.1", "NOT-SET");
        string oldVersionExe = Path.Combine(dir, "oldversion", "HexShift.exe");
        BuildExe(oldVersionExe, "2.1.0", keyText);

        string installer = Path.Combine(dir, "HexShift-2.1.1-Setup.exe");
        BuildExe(installer, "2.1.1", null);
        byte[] installerBytes = File.ReadAllBytes(installer);
        string wrongVersionInstaller = Path.Combine(dir, "wrongversion", "HexShift-2.1.1-Setup.exe");
        BuildExe(wrongVersionInstaller, "2.1.0", null);

        byte[] feed = FeedOf(Item("2.1.1", Rel("2.1.1", "HexShift-2.1.1-Setup.exe"), Sign(installerBytes), installerBytes.Length.ToString(), "windows", "", "Notes."));
        string feedFile = Path.Combine(dir, "appcast.json");
        File.WriteAllBytes(feedFile, feed);
        string sigFile = Path.Combine(dir, "appcast.json.signature");
        File.WriteAllText(sigFile, Sign(feed));

        string output;
        int exit = RunGate(GateArgs(feedFile, sigFile, keyFile, goodExe, installer, "v2.1.1"), out output);
        Is(true, exit == 0 && output.Contains("RELEASE CHECK PASSED"), "the release gate passes consistent artifacts (exit " + exit + ")");
        Is(true, output.Contains("built into") && !output.Contains("FAIL"), "...including the key built into the shipped EXE");

        exit = RunGate(GateArgs(feedFile, sigFile, keyFile, otherKeyExe, installer, "v2.1.1"), out output);
        Is(true, exit == 1 && output.Contains("FAIL  the public key built into"), "the gate fails when the EXE carries a different key than the key file");
        exit = RunGate(GateArgs(feedFile, sigFile, keyFile, noKeyExe, installer, "v2.1.1"), out output);
        Is(true, exit == 1 && output.Contains("FAIL  the public key built into"), "the gate fails when the EXE still says NOT-SET");
        exit = RunGate(GateArgs(feedFile, sigFile, keyFile, oldVersionExe, installer, "v2.1.1"), out output);
        Is(true, exit == 1 && output.Contains("FAIL  the shipped EXE's version equals the tag"), "the gate fails when the EXE's version is not the tag");
        exit = RunGate(GateArgs(feedFile, sigFile, keyFile, goodExe, wrongVersionInstaller, "v2.1.1"), out output);
        Is(true, exit == 1 && output.Contains("FAIL  the installer's embedded product version equals the tag"), "the gate fails when the installer's embedded version is not the tag");
        exit = RunGate(GateArgs(feedFile, sigFile, keyFile, goodExe, installer, "v2.1.2"), out output);
        Is(true, exit == 1 && output.Contains("FAIL"), "the gate fails when the tag does not match anything");

        string otherKeyFile = Path.Combine(dir, "other-key.txt");
        File.WriteAllText(otherKeyFile, Convert.ToBase64String(otherPub));
        exit = RunGate(GateArgs(feedFile, sigFile, otherKeyFile, goodExe, installer, "v2.1.1"), out output);
        Is(true, exit == 1 && output.Contains("FAIL  the feed's signature verifies"), "the gate fails when the feed was not signed with the key file's key");

        byte[] tampered = (byte[])feed.Clone();
        tampered[tampered.Length / 2] ^= 1;
        string tamperedFile = Path.Combine(dir, "tampered.json");
        File.WriteAllBytes(tamperedFile, tampered);
        exit = RunGate(GateArgs(tamperedFile, sigFile, keyFile, goodExe, installer, "v2.1.1"), out output);
        Is(true, exit == 1, "the gate fails on a feed changed after signing");

        exit = RunGate(new[] { "verify-release", "--feed", feedFile }, out output);
        Is(true, exit == 2, "the gate refuses to run without all its options");
    }
}
