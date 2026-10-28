// Hex Shift - Windows host.
//
// One EXE, nothing to install. The page (HexShift.html) and the WebView2 SDK
// assemblies are embedded as resources; the managed ones are loaded from
// memory and the native loader is written under %LOCALAPPDATA%\HexShift once.
//
// Written in C# 5 on purpose: it compiles with the csc.exe that ships inside
// every Windows install, so the app can be built without any SDK.

using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Windows.Forms;

namespace HexShift
{
    static class Program
    {
        public const string Version = "3.2.0";

        [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern IntPtr LoadLibraryExW(string path, IntPtr reserved, uint flags);

        [STAThread]
        static void Main()
        {
            AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbedded;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try { RejectSideBySideAssemblies(typeof(Program).Assembly.Location); Run(); }
            catch (Exception ex) { MessageBox.Show("Hex Shift could not start safely.\n\n" + ex.Message, "Hex Shift", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }

        // The three managed assemblies HexShift carries inside itself. Windows looks for a file of
        // the same name next to the EXE (and in a folder of that name) BEFORE the resolver below is
        // asked, and none of them can be trusted to refuse an impostor, so a planted copy would run
        // inside HexShift, including the update signature check. Refuse to start instead. A .config
        // file beside the EXE can redirect assembly loading the same way, and HexShift ships none.
        internal static readonly string[] EmbeddedAssemblies = { "Microsoft.Web.WebView2.Core", "Microsoft.Web.WebView2.WinForms", "Chaos.NaCl" };

        internal static void RejectSideBySideAssemblies(string exePath)
        {
            string folder = Path.GetDirectoryName(Path.GetFullPath(exePath));
            if (File.Exists(exePath + ".config"))
                throw new IOException("A file named " + Path.GetFileName(exePath) + ".config sits next to HexShift.exe and could redirect which code it loads. Remove it, or move HexShift.exe to a folder of its own.");
            foreach (string name in EmbeddedAssemblies)
            {
                foreach (string candidate in new[] { Path.Combine(folder, name + ".dll"), Path.Combine(folder, name + ".exe"), Path.Combine(folder, name, name + ".dll"), Path.Combine(folder, name, name + ".exe") })
                    if (File.Exists(candidate))
                        throw new IOException("A file named " + name + " sits next to HexShift.exe and would replace a part HexShift carries inside itself. Remove it, or move HexShift.exe to a folder of its own.");
            }
        }

        // Kept separate from Main so no WebView2 type is touched before the resolver is wired up.
        static void Run()
        {
            string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HexShift");
            RejectRedirects(dataDir);
            Directory.CreateDirectory(dataDir);
            RejectRedirects(dataDir);
            string loader = ExtractLoader(dataDir);
            // Deny writes and deletion while verifying and loading the exact file.
            using (FileStream locked = new FileStream(loader, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (!Matches(locked, LoaderBytes())) throw new IOException("WebView2 loader integrity check failed.");
                if (LoadLibraryExW(loader, IntPtr.Zero, 0x00000100 | 0x00000800) == IntPtr.Zero)
                    throw new IOException("The verified WebView2 loader could not be loaded (" + Marshal.GetLastWin32Error() + ").");
            }
            Application.Run(new MainForm(dataDir));
        }

        static Assembly ResolveEmbedded(object sender, ResolveEventArgs args)
        {
            string name = new AssemblyName(args.Name).Name;
            if (Array.IndexOf(EmbeddedAssemblies, name) < 0) return null;
            using (Stream s = typeof(Program).Assembly.GetManifestResourceStream(name + ".dll"))
            {
                if (s == null) return null;
                byte[] buf = new byte[s.Length];
                int read = 0;
                while (read < buf.Length)
                {
                    int n = s.Read(buf, read, buf.Length - read);
                    if (n <= 0) throw new EndOfStreamException();
                    read += n;
                }
                return Assembly.Load(buf);
            }
        }

        internal static void RejectRedirects(string path)
        {
            for (string current = Path.GetFullPath(path); !string.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
                if ((Directory.Exists(current) || File.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Refusing a redirected application data path.");
        }

        static string LoaderArchitecture()
        {
            // The process architecture determines which embedded DLL can be loaded.
            string arch = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "";
            return arch.Equals("ARM64", StringComparison.OrdinalIgnoreCase) && Environment.Is64BitProcess ? "arm64" : Environment.Is64BitProcess ? "x64" : "x86";
        }

        static byte[] LoaderBytes()
        {
            using (Stream s = typeof(Program).Assembly.GetManifestResourceStream("WebView2Loader." + LoaderArchitecture() + ".dll"))
            {
                if (s == null) throw new IOException("The embedded WebView2 loader is missing.");
                using (MemoryStream memory = new MemoryStream()) { s.CopyTo(memory); return memory.ToArray(); }
            }
        }

        internal static bool Matches(Stream file, byte[] expected)
        {
            using (SHA256 hash = SHA256.Create())
            {
                byte[] a = hash.ComputeHash(file), b = hash.ComputeHash(expected);
                int difference = a.Length ^ b.Length;
                for (int i = 0; i < a.Length && i < b.Length; i++) difference |= a[i] ^ b[i];
                return difference == 0;
            }
        }

        // The native DLL is replaced atomically, verified on every startup, and never
        // resolved by searching the current directory or PATH.
        static string ExtractLoader(string dataDir)
        {
            string arch = LoaderArchitecture();
            string dir = Path.Combine(dataDir, "loader-" + Version + "-" + arch);
            string path = Path.Combine(dir, "WebView2Loader.dll");
            byte[] expected = LoaderBytes();
            RejectRedirects(path);
            Directory.CreateDirectory(dir);
            RejectRedirects(path);
            if (File.Exists(path)) using (FileStream file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)) { if (Matches(file, expected)) return path; }
            string tmp = Path.Combine(dir, Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (FileStream f = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { f.Write(expected, 0, expected.Length); f.Flush(true); }
                RejectRedirects(path);
                if (File.Exists(path)) File.Replace(tmp, path, null); else File.Move(tmp, path);
            }
            finally { if (File.Exists(tmp)) File.Delete(tmp); }
            RejectRedirects(path);
            return path;
        }
    }
}
