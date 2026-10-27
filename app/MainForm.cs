using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace HexShift
{
    class MainForm : Form
    {
        // The page is served from this made-up origin so it runs as a normal https page
        // (clipboard, downloads and file drops all behave) without touching the network.
        internal const string Origin = "https://hexshift.invalid";
        const string RuntimeDownload = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

        readonly string dataDir;
        readonly WebView2 web;
        readonly bool dark;
        readonly UpdateController updates;

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        public MainForm(string dataDir)
        {
            this.dataDir = dataDir;
            dark = SystemUsesDarkMode();
            Text = "Hex Shift";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1280, 840);
            MinimumSize = new Size(720, 540);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

            // Same ground the page paints, so nothing flashes before it loads.
            Color ground = dark ? Color.FromArgb(0x15, 0x14, 0x1B) : Color.FromArgb(0xF4, 0xF3, 0xF8);
            BackColor = ground;
            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = ground;
            Controls.Add(web);
            // The update notice docks above the page; it is added after the page so Fill still gets the rest.
            updates = new UpdateController(this, dataDir, dark);
            Controls.Add(updates.Bar);
            FormClosing += delegate { updates.Cancel(); };
            Load += OnLoad;
        }

        static bool SystemUsesDarkMode()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                {
                    if (k == null) return false;
                    object v = k.GetValue("AppsUseLightTheme");
                    return v is int && (int)v == 0;
                }
            }
            catch (Exception) { return false; }
        }

        // Ask the window manager for a dark title bar when the system is dark (Windows 10 1809+).
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            updates.AttachSystemMenu(Handle);
            if (!dark) return;
            int on = 1;
            try
            {
                if (DwmSetWindowAttribute(Handle, 20, ref on, 4) != 0) DwmSetWindowAttribute(Handle, 19, ref on, 4);
            }
            catch (Exception) { }
        }

        // The "Check for updates" commands live in the window's system menu.
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x112 && updates != null && updates.HandleSysCommand(m.WParam)) return;
            base.WndProc(ref m);
        }

        async void OnLoad(object sender, EventArgs e)
        {
            try
            {
                string profile = Path.Combine(dataDir, "WebView2-v2");
                Program.RejectRedirects(profile);
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, profile, null);
                await web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                string msg = "Hex Shift draws its window with the Microsoft Edge WebView2 runtime, which this PC does not seem to have.\n\n"
                    + "It is a free, small download from Microsoft and comes with Windows 11 and most Windows 10 machines.\n\n"
                    + "Open the download page now?\n\n(" + ex.Message + ")";
                DialogResult r = MessageBox.Show(this, msg, "Hex Shift", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (r == DialogResult.Yes) OpenExternal(RuntimeDownload);
                Close();
                return;
            }

            CoreWebView2 core = web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            core.Settings.AreBrowserAcceleratorKeysEnabled = true;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.IsWebMessageEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.AreDefaultScriptDialogsEnabled = false;
            core.Settings.IsBuiltInErrorPageEnabled = false;

            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            core.WebResourceRequested += ServePage;
            core.DownloadStarting += OnDownloadStarting;
            core.NewWindowRequested += OnNewWindow;
            core.LaunchingExternalUriScheme += delegate(object s, CoreWebView2LaunchingExternalUriSchemeEventArgs args) { args.Cancel = true; };
            core.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs args) { args.Cancel = !IsAppDocument(args.Uri); };
            core.FrameNavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs args) { args.Cancel = true; };
            core.PermissionRequested += delegate(object s, CoreWebView2PermissionRequestedEventArgs args)
            {
                // Reading the clipboard requires the normal explicit paste gesture.
                // Async clipboard write does not require ClipboardRead permission.
                args.State = CoreWebView2PermissionState.Deny;
                args.SavesInProfile = false;
                args.Handled = true;
            };
            core.Navigate(Origin + "/");
            updates.StartAutomaticCheck();
        }

        internal static bool IsAppDocument(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Scheme == "https" && uri.Host == "hexshift.invalid" && uri.IsDefaultPort && string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Query)
                && (uri.AbsolutePath == "/" || uri.AbsolutePath == "/index.html" || uri.AbsolutePath == "/HexShift.html");
        }

        // Every file the page may save: MIME type -> extension, Save As filter and dialog title.
        static readonly Dictionary<string, string[]> ExportTypes = new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            { "image/png", new[] { ".png", "PNG image (*.png)|*.png", "Save the shifted image" } },
            { "image/webp", new[] { ".webp", "WebP image (*.webp)|*.webp", "Save the shifted image" } },
            { "application/zip", new[] { ".zip", "ZIP archive (*.zip)|*.zip", "Save the emoji pack" } },
            { "application/x-gimp-palette", new[] { ".gpl", "GIMP palette (*.gpl)|*.gpl", "Save the palette" } },
        };

        internal static bool IsExportDownload(string document, string url, string mime)
        {
            return IsAppDocument(document) && IsAppBlob(url) && mime != null && ExportTypes.ContainsKey(mime);
        }

        internal static bool IsAppBlob(string url)
        {
            const string prefix = "blob:" + Origin + "/";
            Guid identifier;
            return url != null && url.StartsWith(prefix, StringComparison.Ordinal) && Guid.TryParse(url.Substring(prefix.Length), out identifier);
        }

        internal static bool HasExportExtension(string path, string extension)
        {
            bool known = false;
            foreach (string[] type in ExportTypes.Values) known |= type[0] == extension;
            try { return known && string.Equals(Path.GetExtension(path), extension, StringComparison.OrdinalIgnoreCase); }
            catch (ArgumentException) { return false; }
        }

        void ServePage(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            // Some runtime versions surface local blob/data loads here too. Let
            // the browser resolve its own image/worker bytes, never the network.
            if (IsAppBlob(e.Request.Uri) || (e.ResourceContext == CoreWebView2WebResourceContext.Image && e.Request.Uri.StartsWith("data:image/png;base64,", StringComparison.Ordinal))) return;
            CoreWebView2Environment env = web.CoreWebView2.Environment;
            if (e.Request.Method == "GET" && IsAppDocument(e.Request.Uri))
            {
                Stream s = typeof(MainForm).Assembly.GetManifestResourceStream("HexShift.html");
                e.Response = env.CreateWebResourceResponse(s, 200, "OK", "Content-Type: text/html; charset=utf-8\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: frame-ancestors 'none'\r\nReferrer-Policy: no-referrer\r\nCache-Control: no-store");
            }
            else
            {
                e.Response = env.CreateWebResourceResponse(null, 403, "Blocked", "Cache-Control: no-store");
            }
        }

        // The page's Download button becomes a normal Save As dialog.
        void OnDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs e)
        {
            string mime = e.DownloadOperation.MimeType;
            if (!IsExportDownload(web.CoreWebView2.Source, e.DownloadOperation.Uri, mime))
            { e.Cancel = true; e.Handled = true; return; }
            string[] type = ExportTypes[mime];
            string extension = type[0];
            CoreWebView2Deferral deferral = e.GetDeferral();
            e.Handled = true;
            string suggested = "";
            try { suggested = Path.GetFileNameWithoutExtension(e.ResultFilePath) + extension; } catch (Exception) { }
            BeginInvoke(new Action(delegate
            {
                try
                {
                    using (SaveFileDialog dlg = new SaveFileDialog())
                    {
                        dlg.Title = type[2];
                        dlg.FileName = string.IsNullOrEmpty(suggested) ? "emoji-shifted" + extension : suggested;
                        dlg.Filter = type[1];
                        dlg.DefaultExt = extension.Substring(1);
                        dlg.AddExtension = true;
                        dlg.OverwritePrompt = true;
                        // Validate before accepting: changing the extension after Save As
                        // would bypass its overwrite prompt for the actual destination.
                        dlg.FileOk += delegate(object s, System.ComponentModel.CancelEventArgs args)
                        {
                            if (!HasExportExtension(dlg.FileName, extension))
                            {
                                args.Cancel = true;
                                MessageBox.Show(this, "Choose a filename ending in " + extension + ".", "Hex Shift", MessageBoxButtons.OK, MessageBoxIcon.Information);
                            }
                        };
                        if (dlg.ShowDialog(this) == DialogResult.OK) e.ResultFilePath = dlg.FileName;
                        else e.Cancel = true;
                    }
                }
                catch (Exception) { e.Cancel = true; }
                finally { deferral.Complete(); }
            }));
        }

        void OnNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
        }

        internal static void OpenExternal(string url)
        {
            // No webpage-supplied URL or external protocol is ever shell-executed.
            if (url != RuntimeDownload && url != "https://github.com/mistercr0wbar/HexShift" && url != UpdatePolicy.ReleasesUrl) return;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(url);
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch (Exception) { }
        }
    }
}
