using System;
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
        const string Origin = "https://hexshift.app";
        const string RuntimeDownload = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

        readonly string dataDir;
        readonly WebView2 web;
        readonly bool dark;

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
            if (!dark) return;
            int on = 1;
            try
            {
                if (DwmSetWindowAttribute(Handle, 20, ref on, 4) != 0) DwmSetWindowAttribute(Handle, 19, ref on, 4);
            }
            catch (Exception) { }
        }

        async void OnLoad(object sender, EventArgs e)
        {
            try
            {
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "WebView2"), null);
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

            core.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += ServePage;
            core.DownloadStarting += OnDownloadStarting;
            core.NewWindowRequested += OnNewWindow;
            core.Navigate(Origin + "/");
        }

        void ServePage(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            string path;
            try { path = new Uri(e.Request.Uri).AbsolutePath; } catch (Exception) { path = ""; }
            CoreWebView2Environment env = web.CoreWebView2.Environment;
            if (path == "/" || path == "/index.html" || path == "/HexShift.html")
            {
                Stream s = typeof(MainForm).Assembly.GetManifestResourceStream("HexShift.html");
                e.Response = env.CreateWebResourceResponse(s, 200, "OK", "Content-Type: text/html; charset=utf-8");
            }
            else
            {
                e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "");
            }
        }

        // The page's Download button becomes a normal Save As dialog.
        void OnDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs e)
        {
            CoreWebView2Deferral deferral = e.GetDeferral();
            e.Handled = true;
            string suggested = "";
            try { suggested = Path.GetFileName(e.ResultFilePath); } catch (Exception) { }
            BeginInvoke(new Action(delegate
            {
                try
                {
                    using (SaveFileDialog dlg = new SaveFileDialog())
                    {
                        dlg.Title = "Save the shifted image";
                        dlg.FileName = string.IsNullOrEmpty(suggested) ? "emoji-shifted.png" : suggested;
                        dlg.Filter = "PNG image (*.png)|*.png|All files (*.*)|*.*";
                        dlg.OverwritePrompt = true;
                        if (dlg.ShowDialog(this) == DialogResult.OK) e.ResultFilePath = dlg.FileName;
                        else e.Cancel = true;
                    }
                }
                finally { deferral.Complete(); }
            }));
        }

        void OnNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            OpenExternal(e.Uri);
        }

        static void OpenExternal(string url)
        {
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
