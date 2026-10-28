// Hex Shift - the update notice.
//
// A slim bar across the top of the window, plain WinForms, never a modal window: it says
// an update exists, shows progress, and asks before anything is installed. Everything that
// is only information (checking, up to date, could not check) goes to the page as an
// "update-state" message (HostMessages.cs) and appears in its status bar; the page's Help menu
// sends back the few exact commands it may (check now, automatic checks on or off).
//
// C# 5 on purpose, like the rest of the host.

using System;
using System.ComponentModel;
using System.Drawing;
using System.IO;
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

    // The Graphite theme for the few native controls, matching the page default.
    static class Graphite
    {
        internal static void Style(Button b, bool dark, bool primary)
        {
            b.FlatStyle = FlatStyle.Flat;
            b.UseVisualStyleBackColor = false;
            Color raised = dark ? Color.FromArgb(0x26, 0x26, 0x26) : Color.White;
            Color ink = dark ? Color.FromArgb(0xEC, 0xEC, 0xEC) : Color.FromArgb(0x17, 0x17, 0x17);
            b.BackColor = primary ? ink : raised;
            b.ForeColor = primary ? (dark ? Color.FromArgb(0x0A, 0x0A, 0x0A) : Color.White) : ink;
            b.FlatAppearance.BorderColor = primary ? ink : (dark ? Color.FromArgb(0x3D, 0x3D, 0x3D) : Color.FromArgb(0xC4, 0xC4, 0xC4));
            b.FlatAppearance.BorderSize = 1;
        }
    }

    sealed class UpdateBar : Panel
    {
        readonly Label message = new Label();
        readonly ProgressBar meter = new ProgressBar();
        readonly FlowLayoutPanel buttons = new FlowLayoutPanel();
        readonly Button[] slots = new Button[] { new Button(), new Button(), new Button() };
        readonly Action[] actions = new Action[3];
        readonly bool dark;

        internal UpdateBar(bool dark)
        {
            Dock = DockStyle.Top;
            Height = 46;
            Visible = false;
            Padding = new Padding(14, 7, 10, 7);
            this.dark = dark;
            BackColor = dark ? Color.FromArgb(0x1C, 0x1C, 0x1C) : Color.FromArgb(0xF6, 0xF6, 0xF6);
            ForeColor = dark ? Color.FromArgb(0xEC, 0xEC, 0xEC) : Color.FromArgb(0x17, 0x17, 0x17);
            Font = new Font("Segoe UI", 9f);
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
                Graphite.Style(slot, dark, false);
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
                if (used)
                {
                    slots[i].Text = choices[i].Text;
                    // The last choice is the one that moves the update on.
                    Graphite.Style(slots[i], dark, i == choices.Length - 1);
                }
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
        readonly Form owner;
        readonly UpdateService service;
        readonly UpdateBar bar;
        readonly bool installedCopy;
        readonly bool dark;
        CancellationTokenSource cancel;
        System.Windows.Forms.Timer launchTimer;
        System.Windows.Forms.Timer recheckTimer;
        bool busy;
        bool downloading;
        bool manualRequested;
        UpdateOffer offer;
        string stagedPath;
        // Where the check stands, as the page is told it (UpdateState).
        string phase = UpdateState.Idle;
        string phaseVersion;
        string phaseDetail;
        int phasePercent;
        bool phaseManual;

        // Receives an "update-state" message whenever the state changes, on the window's thread.
        internal Action<string> StateChanged;

        internal UpdateController(Form owner, string dataDir, bool dark) : this(owner, UpdateService.ForRelease(dataDir), dark) { }

        // Takes the service ready-made, so a test can point it at a loopback server or give it no key.
        internal UpdateController(Form owner, UpdateService service, bool dark)
        {
            this.owner = owner;
            this.dark = dark;
            this.service = service;
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

        // ---- the page's commands and the state it is shown ----------------------------

        // The commands the page may send (HostMessages.Parse has already checked the words and the
        // sender). Returns false for anything else.
        internal bool HandlePageMessage(PageMessage kind)
        {
            switch (kind)
            {
                case PageMessage.CheckUpdates: CheckNow(); return true;
                case PageMessage.AutoUpdatesOn: SetAutoCheck(true); return true;
                case PageMessage.AutoUpdatesOff: SetAutoCheck(false); return true;
                case PageMessage.UpdateState: Publish(); return true;
            }
            return false;
        }

        internal void SetAutoCheck(bool on)
        {
            service.AutoCheck = on;
            Publish();
        }

        internal string StateJson()
        {
            return UpdateState.Json(phase, phaseVersion, service.LastCheckUtc, service.AutoCheck, service.Enabled, phaseManual, phaseDetail, phasePercent);
        }

        internal void Publish()
        {
            Action<string> send = StateChanged;
            if (send != null) send(StateJson());
        }

        void SetPhase(string next, string version, string detail, bool manual)
        {
            phase = next;
            phaseVersion = version;
            phaseDetail = detail;
            phaseManual = manual;
            phasePercent = 0;
            Publish();
        }

        // ---- checking ----------------------------------------------------------------

        // Called once the page has loaded. With automatic checks on, a check starts a couple of seconds
        // later on every launch (so starting is never slowed down), and another follows every few hours
        // while the window stays open (UpdatePolicy).
        internal void StartAutomaticChecks()
        {
            if (launchTimer != null || !service.Enabled) return;
            launchTimer = new System.Windows.Forms.Timer();
            launchTimer.Interval = (int)UpdatePolicy.LaunchDelay.TotalMilliseconds;
            launchTimer.Tick += delegate
            {
                launchTimer.Stop();
                // The person may have switched automatic checks off during the wait.
                if (service.CheckAtLaunch) RunScheduledCheck();
                recheckTimer = new System.Windows.Forms.Timer();
                recheckTimer.Interval = (int)UpdatePolicy.RecheckInterval.TotalMilliseconds;
                recheckTimer.Tick += delegate { RunScheduledCheck(); };
                recheckTimer.Start();
            };
            launchTimer.Start();
        }

        void RunScheduledCheck()
        {
            if (UpdatePolicy.CanRunScheduledCheck(service.Enabled && service.AutoCheck, busy, downloading, offer != null)) BeginCheck(false);
        }

        internal void Cancel()
        {
            if (launchTimer != null) launchTimer.Stop();
            if (recheckTimer != null) recheckTimer.Stop();
            if (cancel != null) cancel.Cancel();
        }

        void CheckNow()
        {
            if (!service.Enabled)
            {
                SetPhase(UpdateState.Failed, null, "Updates are not available in this build of Hex Shift.", true);
                return;
            }
            if (busy)
            {
                // A check is already running (probably the automatic one): the person who asked gets
                // the answer when it arrives, and the page is told it is theirs.
                if (!downloading)
                {
                    manualRequested = true;
                    phaseManual = true;
                    Publish();
                }
                return;
            }
            // An update that was already found is shown again; the page is told it was asked.
            if (offer != null)
            {
                phaseManual = true;
                Publish();
                if (stagedPath != null) ShowReady();
                else ShowAvailable();
            }
            else BeginCheck(true);
        }

        void BeginCheck(bool manual)
        {
            if (busy) return;
            busy = true;
            SetPhase(UpdateState.Checking, null, null, manual);
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
            // An update is shown in the notice bar. "Up to date" and "could not check" are only
            // information, so they go to the page's status bar and never open a window.
            switch (outcome.Kind)
            {
                case CheckKind.Available:
                    offer = outcome.Offer;
                    SetPhase(UpdateState.Available, offer.Version, null, manual);
                    ShowAvailable();
                    return;
                case CheckKind.UpToDate:
                    SetPhase(UpdateState.Current, service.CurrentVersion, null, manual);
                    return;
                default:
                    SetPhase(UpdateState.Failed, null, outcome.Message, manual);
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
            SetPhase(UpdateState.Downloading, target.Version, null, false);
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
                        Post(delegate
                        {
                            bar.Display(label + " " + percent + "%", percent, new BarButton("Cancel", delegate { if (cancel != null) cancel.Cancel(); }));
                            // The page hears about whole percents only, not every chunk.
                            if (percent != phasePercent) { phasePercent = percent; Publish(); }
                        });
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
                SetPhase(UpdateState.Ready, offer.Version, null, false);
                ShowReady();
            }
            else if (failure != null)
            {
                SetPhase(UpdateState.Failed, offer.Version, "The update could not be downloaded. " + failure, false);
                bar.Display("The update could not be downloaded. " + failure, -1,
                    new BarButton("Dismiss", bar.Dismiss),
                    new BarButton("Try again", BeginDownload));
            }
            else
            {
                SetPhase(UpdateState.Available, offer.Version, null, false);
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
                dialog.BackColor = dark ? Color.FromArgb(0x1C, 0x1C, 0x1C) : Color.FromArgb(0xF6, 0xF6, 0xF6);
                dialog.ForeColor = dark ? Color.FromArgb(0xEC, 0xEC, 0xEC) : Color.FromArgb(0x17, 0x17, 0x17);
                dialog.Font = new Font("Segoe UI", 9f);

                string notes = (offer.Notes ?? "").Replace("\r\n", "\n").Replace("\n", "\r\n").Trim();
                TextBox box = new TextBox();
                box.Multiline = true;
                box.ReadOnly = true;
                box.ScrollBars = ScrollBars.Vertical;
                box.Location = new Point(12, 12);
                box.Size = new Size(516, 316);
                box.Text = notes.Length > 0 ? notes : "The notes for this version are on its release page.";
                box.AccessibleName = "Release notes";
                box.BorderStyle = BorderStyle.FixedSingle;
                box.BackColor = dark ? Color.FromArgb(0x26, 0x26, 0x26) : Color.White;
                box.ForeColor = dialog.ForeColor;

                Button page = new Button();
                page.Text = "Open release page";
                page.AutoSize = true;
                page.Location = new Point(12, 338);
                Graphite.Style(page, dark, false);
                page.Click += delegate { MainForm.OpenExternal(UpdatePolicy.ReleasesUrl); };
                Button close = new Button();
                close.Text = "Close";
                close.Location = new Point(448, 338);
                close.DialogResult = DialogResult.Cancel;
                Graphite.Style(close, dark, true);
                dialog.CancelButton = close;
                dialog.Controls.Add(box);
                dialog.Controls.Add(page);
                dialog.Controls.Add(close);
                if (dark) dialog.HandleCreated += delegate { MainForm.DarkTitleBar(dialog.Handle); };
                dialog.ShowDialog(owner);
            }
        }

        // The last word before anything is installed. The default answer is always the safe one.
        internal bool Installing { get; private set; }

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
            if (installedCopy) { Installing = true; owner.Close(); }
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
