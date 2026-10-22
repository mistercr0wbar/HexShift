// Hex Shift - the update notice.
//
// A slim bar across the top of the window, plain WinForms, never a modal window: it says
// an update exists, shows progress, and asks before anything is installed. The page
// itself cannot talk to the host (web messages are switched off on purpose), so none of
// this goes through the page. "Check for updates" lives in the window's system menu
// (right-click the title bar, or Alt+Space).
//
// C# 5 on purpose, like the rest of the host.

using System;
using System.ComponentModel;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace HexShift
{
    sealed class BarButton
    {
        internal readonly string Text;
        internal readonly Action Click;
        internal BarButton(string text, Action click) { Text = text; Click = click; }
    }

    sealed class UpdateBar : Panel
    {
        readonly Label message = new Label();
        readonly ProgressBar meter = new ProgressBar();
        readonly FlowLayoutPanel buttons = new FlowLayoutPanel();
        readonly Button[] slots = new Button[] { new Button(), new Button(), new Button() };
        readonly Action[] actions = new Action[3];

        internal UpdateBar(bool dark)
        {
            Dock = DockStyle.Top;
            Height = 46;
            Visible = false;
            Padding = new Padding(14, 7, 10, 7);
            BackColor = dark ? Color.FromArgb(0x26, 0x23, 0x33) : Color.FromArgb(0xE4, 0xE1, 0xF2);
            ForeColor = dark ? Color.FromArgb(0xEE, 0xEC, 0xF6) : Color.FromArgb(0x1B, 0x19, 0x24);
            AccessibleName = "Update notice";

            message.Dock = DockStyle.Fill;
            message.TextAlign = ContentAlignment.MiddleLeft;
            message.AutoEllipsis = true;
            message.AccessibleName = "Update status";

            meter.Dock = DockStyle.Right;
            meter.Width = 170;
            meter.Margin = new Padding(8, 8, 8, 8);
            meter.Visible = false;
            meter.AccessibleName = "Download progress";

            buttons.Dock = DockStyle.Right;
            buttons.AutoSize = true;
            buttons.AutoSizeMode = AutoSizeMode.GrowAndShrink; // shrink again after a three-button state
            buttons.WrapContents = false;
            buttons.FlowDirection = FlowDirection.RightToLeft;

            // Added last-slot-first so the first choice sits leftmost and the last one rightmost.
            for (int i = slots.Length - 1; i >= 0; i--)
            {
                Button slot = slots[i];
                int index = i;
                slot.AutoSize = true;
                slot.MinimumSize = new Size(0, 30);
                slot.Padding = new Padding(8, 0, 8, 0);
                slot.FlatStyle = FlatStyle.System;
                slot.Visible = false;
                slot.Click += delegate { Action act = actions[index]; if (act != null) act(); };
                buttons.Controls.Add(slot);
            }

            // Docking runs from the last control added back to the first, so Fill goes in first.
            Controls.Add(message);
            Controls.Add(meter);
            Controls.Add(buttons);
        }

        // percent < 0 hides the progress meter. Choices run left to right, at most three.
        internal void Display(string text, int percent, params BarButton[] choices)
        {
            message.Text = text;
            meter.Visible = percent >= 0;
            if (percent >= 0) meter.Value = Math.Min(100, percent);
            for (int i = 0; i < slots.Length; i++)
            {
                bool used = i < choices.Length;
                slots[i].Visible = used;
                actions[i] = used ? choices[i].Click : null;
                if (used) slots[i].Text = choices[i].Text;
            }
            Visible = true;
        }

        internal void Dismiss()
        {
            Visible = false;
        }
    }

    sealed class UpdateController
    {
        const int WmSysCommand = 0x112;
        const int CmdCheck = 0x1000;
        const int CmdAuto = 0x1010;
        const uint MfString = 0x0, MfChecked = 0x8, MfUnchecked = 0x0, MfSeparator = 0x800, MfByCommand = 0x0;

        [DllImport("user32.dll")]
        static extern IntPtr GetSystemMenu(IntPtr hWnd, bool revert);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool AppendMenuW(IntPtr hMenu, uint flags, UIntPtr id, string text);
        [DllImport("user32.dll")]
        static extern uint CheckMenuItem(IntPtr hMenu, uint id, uint check);

        readonly Form owner;
        readonly UpdateService service;
        readonly UpdateBar bar;
        readonly bool installedCopy;
        readonly bool dark;
        CancellationTokenSource cancel;
        System.Windows.Forms.Timer startupTimer;
        IntPtr systemMenu = IntPtr.Zero;
        bool busy;
        bool downloading;
        bool manualRequested;
        UpdateOffer offer;
        string stagedPath;

        internal UpdateController(Form owner, string dataDir, bool dark)
        {
            this.owner = owner;
            this.dark = dark;
            service = UpdateService.ForRelease(dataDir);
            installedCopy = IsInstalledCopy();
            bar = new UpdateBar(dark);
        }

        internal Control Bar { get { return bar; } }

        // True when this EXE is the copy the installer put in place (Setup records where it went).
        // A portable EXE is not, and must never be replaced by an update; it offers the installer.
        static bool IsInstalledCopy()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\{44A94DA7-51B1-4BE0-BB05-9E1486733DEA}_is1"))
                {
                    string location = key == null ? null : key.GetValue("InstallLocation") as string;
                    if (string.IsNullOrEmpty(location)) return false;
                    string here = Path.GetFullPath(Path.GetDirectoryName(Application.ExecutablePath)).TrimEnd('\\');
                    return string.Equals(here, Path.GetFullPath(location).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
                }
            }
            catch (Exception) { return false; }
        }

        // ---- system menu -------------------------------------------------------------

        internal void AttachSystemMenu(IntPtr handle)
        {
            try
            {
                systemMenu = GetSystemMenu(handle, false);
                if (systemMenu == IntPtr.Zero) return;
                AppendMenuW(systemMenu, MfSeparator, UIntPtr.Zero, null);
                AppendMenuW(systemMenu, MfString, (UIntPtr)CmdCheck, "Check for &updates...");
                AppendMenuW(systemMenu, MfString | (service.AutoCheck ? MfChecked : MfUnchecked), (UIntPtr)CmdAuto, "Check for updates &automatically");
            }
            catch (Exception) { systemMenu = IntPtr.Zero; }
        }

        // Called for WM_SYSCOMMAND; the low four bits of the id belong to Windows.
        internal bool HandleSysCommand(IntPtr wParam)
        {
            switch ((int)(wParam.ToInt64() & 0xFFF0))
            {
                case CmdCheck: CheckNow(); return true;
                case CmdAuto: ToggleAuto(); return true;
            }
            return false;
        }

        void ToggleAuto()
        {
            service.AutoCheck = !service.AutoCheck;
            if (systemMenu != IntPtr.Zero) CheckMenuItem(systemMenu, CmdAuto, MfByCommand | (service.AutoCheck ? MfChecked : MfUnchecked));
        }

        // ---- checking ----------------------------------------------------------------

        // Waits a few seconds so starting HexShift is never slowed by it.
        internal void StartAutomaticCheck()
        {
            if (!service.IsCheckDue()) return;
            startupTimer = new System.Windows.Forms.Timer();
            startupTimer.Interval = 5000;
            startupTimer.Tick += delegate
            {
                startupTimer.Stop();
                // The person may have switched automatic checks off during the wait.
                if (service.IsCheckDue()) BeginCheck(false);
            };
            startupTimer.Start();
        }

        internal void Cancel()
        {
            if (startupTimer != null) startupTimer.Stop();
            if (cancel != null) cancel.Cancel();
        }

        void CheckNow()
        {
            if (!service.Enabled)
            {
                Info("Updates are not available in this build of HexShift.");
                return;
            }
            if (busy)
            {
                // A check is already running (probably the automatic one): say so, and make sure the
                // person who asked gets the answer when it arrives.
                if (!downloading)
                {
                    manualRequested = true;
                    bar.Display("Checking for updates...", -1);
                }
                return;
            }
            if (offer != null && stagedPath != null) ShowReady();
            else if (offer != null) ShowAvailable();
            else BeginCheck(true);
        }

        void BeginCheck(bool manual)
        {
            if (busy) return;
            busy = true;
            if (manual) bar.Display("Checking for updates...", -1);
            cancel = new CancellationTokenSource();
            CancellationToken token = cancel.Token;
            ThreadPool.QueueUserWorkItem(delegate
            {
                CheckOutcome outcome;
                try { outcome = service.Check(token); }
                catch (OperationCanceledException) { Post(delegate { busy = false; manualRequested = false; }); return; }
                catch (Exception ex) { outcome = CheckOutcome.Of(CheckKind.Failed, "Something unexpected went wrong (" + ex.GetType().Name + ")."); }
                Post(delegate { Checked(outcome, manual); });
            });
        }

        void Checked(CheckOutcome outcome, bool manual)
        {
            busy = false;
            manual = manual || manualRequested;
            manualRequested = false;
            switch (outcome.Kind)
            {
                case CheckKind.Available:
                    offer = outcome.Offer;
                    ShowAvailable();
                    return;
                case CheckKind.UpToDate:
                    bar.Dismiss();
                    if (manual) Info(outcome.Message);
                    return;
                default:
                    bar.Dismiss();
                    if (manual) Info("HexShift could not check for updates.\n\n" + outcome.Message + "\n\nHexShift keeps working as normal.");
                    return;
            }
        }

        // ---- the bar's states --------------------------------------------------------

        void ShowAvailable()
        {
            bar.Display("HexShift " + offer.Version + " is available.", -1,
                new BarButton("Release notes", ShowNotes),
                new BarButton("Later", bar.Dismiss),
                new BarButton("Download update", BeginDownload));
        }

        void ShowReady()
        {
            if (installedCopy)
                bar.Display("HexShift " + offer.Version + " is ready to install. Export your image first: unfinished work is not saved.", -1,
                    new BarButton("Later", bar.Dismiss),
                    new BarButton("Restart and install", ConfirmInstall));
            else
                bar.Display("HexShift " + offer.Version + " is downloaded. This copy is portable, so it cannot update itself.", -1,
                    new BarButton("Later", bar.Dismiss),
                    new BarButton("Open installer", ConfirmInstall));
        }

        void BeginDownload()
        {
            if (busy) return;
            busy = true;
            downloading = true;
            UpdateOffer target = offer;
            string label = "Downloading HexShift " + target.Version + "...";
            bar.Display(label, 0, new BarButton("Cancel", delegate { if (cancel != null) cancel.Cancel(); }));
            cancel = new CancellationTokenSource();
            CancellationToken token = cancel.Token;
            ThreadPool.QueueUserWorkItem(delegate
            {
                string path = null;
                string failure = null;
                try
                {
                    path = service.Download(target, delegate(long done, long total)
                    {
                        int percent = (int)(done * 100 / total);
                        Post(delegate { bar.Display(label + " " + percent + "%", percent, new BarButton("Cancel", delegate { if (cancel != null) cancel.Cancel(); })); });
                    }, token);
                }
                catch (OperationCanceledException) { }
                catch (UpdateException ex) { failure = ex.Message; }
                catch (IOException ex) { failure = "The update could not be saved (" + ex.Message + ")."; }
                catch (UnauthorizedAccessException) { failure = "HexShift is not allowed to save the update."; }
                catch (Exception ex) { failure = "Something unexpected went wrong (" + ex.GetType().Name + ")."; }
                Post(delegate { Downloaded(path, failure); });
            });
        }

        void Downloaded(string path, string failure)
        {
            busy = false;
            downloading = false;
            if (path != null)
            {
                stagedPath = path;
                ShowReady();
            }
            else if (failure != null)
            {
                bar.Display("The update could not be downloaded. " + failure, -1,
                    new BarButton("Dismiss", bar.Dismiss),
                    new BarButton("Try again", BeginDownload));
            }
            else
            {
                ShowAvailable();
            }
        }

        // ---- release notes and installing --------------------------------------------

        void ShowNotes()
        {
            using (Form dialog = new Form())
            {
                dialog.Text = "What is new in HexShift " + offer.Version;
                dialog.StartPosition = FormStartPosition.CenterParent;
                dialog.FormBorderStyle = FormBorderStyle.FixedDialog;
                dialog.MinimizeBox = false;
                dialog.MaximizeBox = false;
                dialog.ShowInTaskbar = false;
                dialog.ClientSize = new Size(540, 380);
                dialog.BackColor = dark ? Color.FromArgb(0x1B, 0x19, 0x24) : Color.FromArgb(0xF4, 0xF3, 0xF8);

                string notes = (offer.Notes ?? "").Replace("\r\n", "\n").Replace("\n", "\r\n").Trim();
                TextBox box = new TextBox();
                box.Multiline = true;
                box.ReadOnly = true;
                box.ScrollBars = ScrollBars.Vertical;
                box.Location = new Point(12, 12);
                box.Size = new Size(516, 316);
                box.Text = notes.Length > 0 ? notes : "The notes for this version are on its release page.";
                box.AccessibleName = "Release notes";

                Button page = new Button();
                page.Text = "Open release page";
                page.AutoSize = true;
                page.Location = new Point(12, 338);
                page.Click += delegate { MainForm.OpenExternal(UpdatePolicy.ReleasesUrl); };
                Button close = new Button();
                close.Text = "Close";
                close.Location = new Point(448, 338);
                close.DialogResult = DialogResult.Cancel;
                dialog.CancelButton = close;
                dialog.Controls.Add(box);
                dialog.Controls.Add(page);
                dialog.Controls.Add(close);
                dialog.ShowDialog(owner);
            }
        }

        // The last word before anything is installed. The default answer is always the safe one.
        void ConfirmInstall()
        {
            if (offer == null || stagedPath == null) return;
            if (installedCopy)
            {
                DialogResult answer = MessageBox.Show(owner,
                    "Restart HexShift to install version " + offer.Version + "?\n\n"
                    + "HexShift will close, install the update, and offer to open again. Anything you have not exported, including your current image and edits, will be lost.\n\n"
                    + "Have you exported your image?",
                    "Hex Shift - install update", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
                if (answer != DialogResult.Yes) return;
            }
            else
            {
                DialogResult answer = MessageBox.Show(owner,
                    "The installer for version " + offer.Version + " will open in its own window and install HexShift for your Windows account.\n\nThis portable copy stays as it is and keeps running.",
                    "Hex Shift - install update", MessageBoxButtons.OKCancel, MessageBoxIcon.Information, MessageBoxDefaultButton.Button1);
                if (answer != DialogResult.OK) return;
            }

            try { service.Install(offer, stagedPath, installedCopy); }
            catch (UpdateException ex) { Info("The update was not installed.\n\n" + ex.Message); return; }
            catch (Win32Exception ex) { Info("Windows would not start the installer (" + ex.Message + ")."); return; }
            catch (IOException ex) { Info("The installer could not be opened (" + ex.Message + ")."); return; }
            // Anything else (a locked-down folder, no memory to check the file) is reported the same
            // plain way, never left to the unhandled-exception dialog.
            catch (Exception ex) { Info("The update was not installed (" + ex.GetType().Name + ")."); return; }
            if (installedCopy) owner.Close();
            else bar.Dismiss();
        }

        // ---- helpers -----------------------------------------------------------------

        void Info(string text)
        {
            MessageBox.Show(owner, text, "Hex Shift", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        // Back onto the window's own thread. Quietly nothing if the window is already gone.
        void Post(Action action)
        {
            try
            {
                if (owner.IsDisposed || !owner.IsHandleCreated) return;
                owner.BeginInvoke(action);
            }
            catch (InvalidOperationException) { } // includes ObjectDisposedException
        }
    }
}
