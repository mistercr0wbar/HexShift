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
using System.Windows.Forms;

namespace HexShift
{
    static class Program
    {
        public const string Version = "1.0.0";

        [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern IntPtr LoadLibraryW(string path);

        [STAThread]
        static void Main()
        {
            AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbedded;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Run();
        }

        // Kept separate from Main so no WebView2 type is touched before the resolver is wired up.
        static void Run()
        {
            string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HexShift");
            Directory.CreateDirectory(dataDir);
            string loader = ExtractLoader(dataDir);
            if (loader != null) LoadLibraryW(loader);
            Application.Run(new MainForm(dataDir));
        }

        static Assembly ResolveEmbedded(object sender, ResolveEventArgs args)
        {
            string name = new AssemblyName(args.Name).Name;
            if (!name.StartsWith("Microsoft.Web.WebView2", StringComparison.OrdinalIgnoreCase)) return null;
            using (Stream s = typeof(Program).Assembly.GetManifestResourceStream(name + ".dll"))
            {
                if (s == null) return null;
                byte[] buf = new byte[s.Length];
                int read = 0;
                while (read < buf.Length)
                {
                    int n = s.Read(buf, read, buf.Length - read);
                    if (n <= 0) break;
                    read += n;
                }
                return Assembly.Load(buf);
            }
        }

        // WebView2Loader.dll is native, so it has to exist on disk. It is written once per version.
        static string ExtractLoader(string dataDir)
        {
            string arch = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "";
            if (arch.Equals("ARM64", StringComparison.OrdinalIgnoreCase)) arch = "arm64";
            else arch = Environment.Is64BitProcess ? "x64" : "x86";

            string dir = Path.Combine(dataDir, "loader-" + Version + "-" + arch);
            string path = Path.Combine(dir, "WebView2Loader.dll");
            if (File.Exists(path)) return path;
            using (Stream s = typeof(Program).Assembly.GetManifestResourceStream("WebView2Loader." + arch + ".dll"))
            {
                if (s == null) return null;
                Directory.CreateDirectory(dir);
                string tmp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
                using (FileStream f = File.Create(tmp)) s.CopyTo(f);
                try { File.Move(tmp, path); }
                catch (IOException) { File.Delete(tmp); }   // another instance got there first
            }
            return path;
        }
    }
}
