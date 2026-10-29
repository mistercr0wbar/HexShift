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
        readonly ScreenPicker picker = new ScreenPicker();
        bool pageAllowsClose;
        bool closePending;

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        [DllImport("user32.dll")]
        static extern IntPtr GetForegroundWindow();

        public MainForm(string dataDir)
        {
            this.dataDir = dataDir;
            dark = SystemColours.AppsUseDarkMode();
            Text = "Hex Shift";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1280, 840);
            MinimumSize = new Size(720, 540);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

            // Same ground the page paints, so nothing flashes before it loads.
            Color ground = dark ? Color.FromArgb(0x14, 0x14, 0x14) : Color.FromArgb(0xE9, 0xE9, 0xE9);
            BackColor = ground;
            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = ground;
            Controls.Add(web);
            // The update notice docks above the page; it is added after the page so Fill still gets the rest.
            updates = new UpdateController(this, dataDir, dark);
            updates.StateChanged = PostToPage;
            Controls.Add(updates.Bar);
            FormClosing += OnClosing;
            Load += OnLoad;
        }

        // Ask the window manager for a dark title bar when the system is dark (Windows 10 1809+).
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (dark) DarkTitleBar(Handle);
        }

        // Windows 10 2004+ uses attribute 20; earlier Windows 10 builds used 19.
        internal static void DarkTitleBar(IntPtr handle)
        {
            int on = 1;
            try
            {
                if (DwmSetWindowAttribute(handle, 20, ref on, 4) != 0) DwmSetWindowAttribute(handle, 19, ref on, 4);
            }
            catch (Exception) { }
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
            // The page may send only the few exact words in HostMessages; the host also sends it the Windows
            // colours for the System theme and where the update check stands.
            core.Settings.IsWebMessageEnabled = true;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.AreDefaultScriptDialogsEnabled = false;
            core.Settings.IsBuiltInErrorPageEnabled = false;

            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            core.WebResourceRequested += ServePage;
            core.DownloadStarting += OnDownloadStarting;
            core.NewWindowRequested += OnNewWindow;
            core.WebMessageReceived += OnWebMessage;
            // File > Exit in the page is window.close(); the page has already asked about unsaved work.
            core.WindowCloseRequested += delegate { pageAllowsClose = true; BeginInvoke(new Action(Close)); };
            // The System theme follows the Windows accent and app mode, now and whenever they change.
            // Once the page is up, the update schedule starts (a check a couple of seconds on) and the page
            // is told where it stands.
            core.NavigationCompleted += delegate
            {
                SendSystemColours();
                updates.StartAutomaticChecks();
                updates.Publish();
            };
            SystemEvents.UserPreferenceChanged += OnPreferenceChanged;
            FormClosed += delegate { SystemEvents.UserPreferenceChanged -= OnPreferenceChanged; };
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
        }

        internal static bool IsAppDocument(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Scheme == "https" && uri.Host == "hexshift.invalid" && uri.IsDefaultPort && string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Query)
                && (uri.AbsolutePath == "/" || uri.AbsolutePath == "/index.html" || uri.AbsolutePath == "/HexShift.html");
        }

        // Closing the native window must ask about background tabs too. The
        // page's File > Exit and title-bar close share one confirmation dialog;
        // its window.close() request is the signal that the person agreed.
        async void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (pageAllowsClose || updates.Installing || web.CoreWebView2 == null || e.CloseReason != CloseReason.UserClosing)
            {
                updates.Cancel();
                return;
            }
            e.Cancel = true;
            if (closePending) return;
            closePending = true;
            try
            {
                string handled = await web.CoreWebView2.ExecuteScriptAsync(
                    "typeof window.hexShiftRequestClose === 'function' ? (window.hexShiftRequestClose(), true) : false");
                if (handled != "true") { pageAllowsClose = true; Close(); }
            }
            catch (Exception) { pageAllowsClose = true; Close(); }
            finally { closePending = false; }
        }

        // Every file the page may save: MIME type -> extension, Save As filter and dialog title.
        static readonly Dictionary<string, string[]> ExportTypes = new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            { "image/png", new[] { ".png", "PNG image (*.png)|*.png", "Save the shifted image" } },
            { "image/webp", new[] { ".webp", "WebP image (*.webp)|*.webp", "Save the shifted image" } },
            { "application/zip", new[] { ".zip", "ZIP archive (*.zip)|*.zip", "Save the emoji pack" } },
            { "application/x-gimp-palette", new[] { ".gpl", "GIMP palette (*.gpl)|*.gpl", "Save the palette" } },
            { "application/json", new[] { ".json", "Hex Shift recipe (*.json)|*.json", "Save the recipe" } },
            { "application/vnd.hexshift.session+json", new[] { ".hexshift", "Hex Shift session (*.hexshift)|*.hexshift", "Save the session" } },
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

        // What the page may ask of the host: the exact words in HostMessages, from the app's own document,
        // and nothing else. The screen-picker button is one (WebView2 will not open the browser's own
        // screen picker, so the host shows one, ScreenPicker.cs, and sends back the colour, or null); the
        // rest belong to the update check shown in the page's status bar and Help menu.
        void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string message = null;
            try { message = e.TryGetWebMessageAsString(); } catch (ArgumentException) { }
            PageMessage kind = HostMessages.Parse(e.Source, message);
            if (kind == PageMessage.None) return;
            if (kind != PageMessage.PickColour) { updates.HandlePageMessage(kind); return; }
            if (picker.Busy) return;
            // Only while someone is using Hex Shift: the page cannot cover the screen behind their back.
            if (GetForegroundWindow() != Handle) { SendPick(null); return; }
            picker.Start(delegate(string hex)
            {
                Activate();
                web.Focus();
                SendPick(hex);
            });
        }

        void PostToPage(string json)
        {
            if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(json);
        }

        void OnPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
        {
            if (e.Category != UserPreferenceCategory.General && e.Category != UserPreferenceCategory.Color
                && e.Category != UserPreferenceCategory.VisualStyle) return;
            if (IsHandleCreated) BeginInvoke(new Action(SendSystemColours));
        }

        void SendSystemColours()
        {
            if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(SystemColours.Current());
        }

        void SendPick(string hex)
        {
            if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(ScreenPick.Reply(hex));
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
