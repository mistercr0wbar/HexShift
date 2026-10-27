using System;
using System.IO;
using System.Reflection;
class HostTests
{
    static int checks;
    static Assembly app;
    static object Call(string type, string method, params object[] args) { return app.GetType("HexShift." + type).GetMethod(method, BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public).Invoke(null, args); }
    static void Check(bool value, string label) { if (!value) throw new Exception(label); checks++; }
    static void Main(string[] argv)
    {
        app = Assembly.LoadFrom(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "HexShift.exe"));
        AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs args)
        {
            string name = new AssemblyName(args.Name).Name;
            if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms" && name != "Chaos.NaCl") return null;
            using (Stream s = app.GetManifestResourceStream(name + ".dll")) using (MemoryStream b = new MemoryStream()) { s.CopyTo(b); return Assembly.Load(b.ToArray()); }
        };
        // Release gate: HostTests.exe verify-release --feed F --signature S --key K --exe E --installer I --tag vX.Y.Z
        if (argv.Length > 0 && argv[0] == "verify-release") { Environment.Exit(ReleaseCheck.Run(argv)); return; }
        // The host's own resolver must hand out the embedded Ed25519 assembly and nothing else.
        object ed25519 = Call("Program", "ResolveEmbedded", null, new ResolveEventArgs("Chaos.NaCl, Version=0.9.4.0, Culture=neutral, PublicKeyToken=null"));
        Check(ed25519 is Assembly && ((Assembly)ed25519).GetName().Name == "Chaos.NaCl", "Embedded Ed25519 assembly resolves");
        Check(Call("Program", "ResolveEmbedded", null, new ResolveEventArgs("Evil.Plugin, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null")) == null, "Unknown assemblies are not resolved");
        foreach (string uri in new[] { "https://hexshift.invalid/", "https://hexshift.invalid/index.html", "https://hexshift.invalid/HexShift.html#colour" }) Check((bool)Call("MainForm", "IsAppDocument", uri), "Allowed document " + uri);
        foreach (string uri in new[] { "https://hexshift.invalid.evil/", "https://evil/", "http://hexshift.invalid/", "file:///C:/Windows/win.ini", "javascript:alert(1)", "ms-settings:test", "https://hexshift.invalid:444/", "https://user@hexshift.invalid/", "https://hexshift.invalid/other", "https://hexshift.invalid/?remote=1" }) Check(!(bool)Call("MainForm", "IsAppDocument", uri), "Blocked document " + uri);
        string blob = "blob:https://hexshift.invalid/12345678-1234-4234-8234-123456789012";
        foreach (string mime in new[] { "image/png", "image/webp", "application/zip", "application/x-gimp-palette" }) Check((bool)Call("MainForm", "IsExportDownload", "https://hexshift.invalid/", blob, mime), "Allowed export download " + mime);
        foreach (string mime in new[] { "application/octet-stream", "text/html", "image/svg+xml", "application/x-zip-compressed", "APPLICATION/ZIP", "text/plain", "application/x-gimp-palette; charset=utf-8", "" }) Check(!(bool)Call("MainForm", "IsExportDownload", "https://hexshift.invalid/", blob, mime), "Blocked download MIME " + mime);
        Check(!(bool)Call("MainForm", "IsExportDownload", "https://hexshift.invalid/", blob, null), "Missing download MIME denied");
        Check(!(bool)Call("MainForm", "IsExportDownload", "https://evil/", blob, "image/png"), "Untrusted download document");
        Check(!(bool)Call("MainForm", "IsExportDownload", "https://hexshift.invalid/", "https://evil/a.png", "image/png"), "Remote download denied");
        Check(!(bool)Call("MainForm", "IsExportDownload", "https://hexshift.invalid/", "blob:https://hexshift.invalid/invalid", "image/png"), "Malformed blob denied");
        Check((bool)Call("MainForm", "HasExportExtension", "image.PNG", ".png"), "PNG extension allowed");
        Check((bool)Call("MainForm", "HasExportExtension", "image.webp", ".webp"), "WebP extension allowed");
        Check((bool)Call("MainForm", "HasExportExtension", "pack.ZIP", ".zip"), "ZIP extension allowed");
        Check((bool)Call("MainForm", "HasExportExtension", "skin tones.gpl", ".gpl"), "GIMP palette extension allowed");
        Check(!(bool)Call("MainForm", "HasExportExtension", "palette.gpl.exe", ".gpl"), "Executable named like a palette denied");
        Check(!(bool)Call("MainForm", "HasExportExtension", "image.exe", ".png"), "Executable extension denied");
        Check(!(bool)Call("MainForm", "HasExportExtension", "image.webp", ".png"), "Mismatched export extension denied");
        Check(!(bool)Call("MainForm", "HasExportExtension", "pack.zip", ".png"), "ZIP name for a PNG denied");
        Check(!(bool)Call("MainForm", "HasExportExtension", "page.html", ".html"), "Unknown export extension denied");
        using (MemoryStream s = new MemoryStream(new byte[] { 1, 2, 3 })) Check((bool)Call("Program", "Matches", s, new byte[] { 1, 2, 3 }), "Embedded loader hash matches");
        using (MemoryStream s = new MemoryStream(new byte[] { 1, 2, 9 })) Check(!(bool)Call("Program", "Matches", s, new byte[] { 1, 2, 3 }), "Modified loader hash is rejected");
        string dir = Path.Combine(Path.GetTempPath(), "HexShift-policy-test-" + Guid.NewGuid().ToString("N"));
        if (!Path.GetFullPath(dir).StartsWith(Path.Combine(Path.GetTempPath(), "HexShift-policy-test-"), StringComparison.OrdinalIgnoreCase)) throw new Exception("Invalid temporary test path");
        Directory.CreateDirectory(dir);
        try
        {
            string path = (string)Call("Program", "ExtractLoader", dir);
            Check(File.Exists(path), "Native loader extracted");
            byte[] expected = File.ReadAllBytes(path); File.WriteAllBytes(path, new byte[] { 0, 1, 2 });
            string repaired = (string)Call("Program", "ExtractLoader", dir);
            using (FileStream s = File.OpenRead(repaired)) Check((bool)Call("Program", "Matches", s, expected), "Tampered loader atomically repaired");
        }
        finally { Directory.Delete(dir, true); }
        Console.WriteLine(checks + " native host policy/integrity checks passed.");
        Console.WriteLine(UpdateTests.Run() + " update policy, feed, download and install checks passed.");
    }
}
