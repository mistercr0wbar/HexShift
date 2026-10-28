// Smoke checks for the notice bar and the controller: the layout the way MainForm composes
// it (page first, bar second, so Fill still gets the rest), the order and action of the
// buttons, the commands the page may send (check now, automatic checks on or off) and the
// phases the page is told about (checking, up to date, available, could not check).
//
// The window is borderless, fully transparent, off-screen and out of the taskbar, and it
// lives for a fraction of a second. Nothing here opens a dialog, and the checks never reach
// the real update sites: the controller is given a service that has no key, or one pointed at
// the loopback test server.
//
// C# 5, like the host.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using HexShift;

static partial class UpdateTests
{
    static void CollectButtons(Control parent, List<Button> into)
    {
        foreach (Control child in parent.Controls)
        {
            Button button = child as Button;
            if (button != null && button.Visible) into.Add(button);
            CollectButtons(child, into);
        }
    }

    // Left to right on screen.
    static List<Button> VisibleButtonsLeftToRight(Control root)
    {
        List<Button> buttons = new List<Button>();
        CollectButtons(root, buttons);
        buttons.Sort(delegate(Button a, Button b)
        {
            return root.PointToClient(a.PointToScreen(Point.Empty)).X.CompareTo(root.PointToClient(b.PointToScreen(Point.Empty)).X);
        });
        return buttons;
    }

    static string Texts(List<Button> buttons)
    {
        List<string> texts = new List<string>();
        foreach (Button b in buttons) texts.Add(b.Text);
        return string.Join("|", texts.ToArray());
    }

    [DllImport("user32.dll")]
    static extern IntPtr GetSystemMenu(IntPtr hWnd, bool revert);
    [DllImport("user32.dll")]
    static extern uint GetMenuState(IntPtr hMenu, uint id, uint flags);

    // Runs the window's message loop until the condition holds (posted work and timers need it).
    static bool Pump(Func<bool> done, int milliseconds)
    {
        DateTime until = DateTime.UtcNow.AddMilliseconds(milliseconds);
        while (DateTime.UtcNow < until)
        {
            Application.DoEvents();
            if (done()) return true;
            Thread.Sleep(10);
        }
        Application.DoEvents();
        return done();
    }

    // The real main window, built but never shown, so the page and WebView2 are not started: the
    // constructor wiring and the dock order.
    static void MainFormChecks(string work)
    {
        string data = Path.Combine(work, "data-mainform");
        Directory.CreateDirectory(data);
        using (MainForm main = new MainForm(data))
        {
            IntPtr handle = main.Handle;
            main.PerformLayout();
            UpdateBar bar = null;
            Control page = null;
            foreach (Control c in main.Controls)
            {
                if (c is UpdateBar) bar = (UpdateBar)c; else page = c;
            }
            Is(true, bar != null && page != null && main.Controls.Count == 2, "the main window holds the page and the notice bar");
            Is(true, bar != null && bar.Dock == DockStyle.Top, "the notice bar is docked to the top");
            Is(true, page != null && page.Dock == DockStyle.Fill, "the page fills the window");
            Is(true, bar != null && page != null && main.Controls.IndexOf(bar) > main.Controls.IndexOf(page), "the bar was added after the page, so the page gets what is left");

            // The update commands moved into the page's Help menu: the title bar's menu is Windows' own again.
            IntPtr system = GetSystemMenu(handle, false);
            Is(true, system != IntPtr.Zero, "the window has its system menu");
            Is(true, GetMenuState(system, 0x1000, 0) == 0xFFFFFFFF, "no 'Check for updates' item in the system menu");
            Is(true, GetMenuState(system, 0x1010, 0) == 0xFFFFFFFF, "no 'Check automatically' item in the system menu");
        }
    }

    // The phases the page is told about, against the loopback server (never the real sites), with
    // the window's message loop pumped so the posted results and the timers run.
    static void ControllerPhaseChecks(string work, Form form)
    {
        using (TestServer s = new TestServer())
        {
            UpdateEndpoints e = Local(s.Base);
            byte[] installer = new byte[64];
            byte[] feed = FeedOf(Item("2.1.1", s.Base + "/dl/HexShift-2.1.1-Setup.exe", Sign(installer), "64", "windows", "", "Fixes things."));
            s.Body("/updates/appcast.json", feed, false);
            s.Body("/updates/appcast.json.signature", Encoding.ASCII.GetBytes(Sign(feed) + "\n"), false);

            // An update is found: the page hears checking, then available, and the notice bar opens.
            UpdateController found = new UpdateController(form, new UpdateService(Path.Combine(work, "data-ui-found"), pub, "2.1.0", e, LocalTransport(e)), false);
            List<string> told = new List<string>();
            found.StateChanged = delegate(string json) { told.Add(json); };
            Is(true, found.HandlePageMessage(PageMessage.CheckUpdates), "a check is started from the page");
            Is(true, found.HandlePageMessage(PageMessage.CheckUpdates), "a second request while checking is accepted");
            Is(true, told.Count == 2 && told[0].Contains("\"phase\":\"checking\"") && told[0].Contains("\"manual\":true") && told[1].Contains("\"phase\":\"checking\""), "...and only tells the page again");
            Is(true, Pump(delegate { return told.Count >= 3; }, 8000), "the check finishes");
            Is(true, told[2].Contains("\"phase\":\"available\"") && told[2].Contains("\"version\":\"2.1.1\"") && told[2].Contains("\"manual\":true"), "the page hears the update that was found");
            Is(true, told[2].Contains("\"checkedAt\":\"2"), "...and when it checked");
            Is(true, s.Hits("/updates/appcast.json") == 1, "two quick requests asked the server once");
            Is(true, found.Bar.Visible, "the notice bar shows the update");
            int asked = s.Requests;
            Is(true, found.HandlePageMessage(PageMessage.CheckUpdates) && told.Count == 4 && told[3].Contains("\"phase\":\"available\""), "asking again repeats the update");
            Is(true, s.Requests == asked, "...without contacting anyone");

            // Up to date: only the page hears, and no window of any kind opens.
            string currentData = Path.Combine(work, "data-ui-current");
            UpdateController current = new UpdateController(form, new UpdateService(currentData, pub, "2.1.1", e, LocalTransport(e)), false);
            List<string> heard = new List<string>();
            current.StateChanged = delegate(string json) { heard.Add(json); };
            current.HandlePageMessage(PageMessage.CheckUpdates);
            Is(true, Pump(delegate { return heard.Count >= 2; }, 8000), "an up-to-date check finishes");
            Is(true, heard[1].Contains("\"phase\":\"current\"") && heard[1].Contains("\"version\":\"2.1.1\""), "the page hears that this version is current");
            Is(false, current.Bar.Visible, "the notice bar stays closed");

            // Every launch checks, even straight after a check: there is no daily gate any more.
            heard.Clear();
            UpdateController launch = new UpdateController(form, new UpdateService(currentData, pub, "2.1.1", e, LocalTransport(e)), false);
            launch.StateChanged = delegate(string json) { heard.Add(json); };
            launch.StartAutomaticChecks();
            Is(true, heard.Count == 0, "nothing is checked the moment the page loads");
            Is(true, Pump(delegate { return heard.Count >= 2; }, 10000), "a check starts about two seconds later, though one finished a moment ago");
            Is(true, heard[0].Contains("\"phase\":\"checking\"") && heard[0].Contains("\"manual\":false") && heard[1].Contains("\"phase\":\"current\""), "...an automatic one, ending up to date");
            launch.Cancel();

            // With automatic checks off, nothing starts at launch.
            heard.Clear();
            UpdateController quiet = new UpdateController(form, new UpdateService(Path.Combine(work, "data-ui-quiet"), pub, "2.1.1", e, LocalTransport(e)), false);
            quiet.StateChanged = delegate(string json) { heard.Add(json); };
            quiet.SetAutoCheck(false);
            int before = s.Hits("/updates/appcast.json");
            quiet.StartAutomaticChecks();
            Pump(delegate { return false; }, 3500);
            Is(true, heard.Count == 1 && heard[0].Contains("\"auto\":false"), "the page hears only that automatic checks are off");
            Is(true, s.Hits("/updates/appcast.json") == before, "...and the server is never asked");
            quiet.Cancel();

            // A check that cannot finish is a quiet failure in the page.
            s.Status("/updates/appcast.json.signature", 404);
            heard.Clear();
            UpdateController broken = new UpdateController(form, new UpdateService(Path.Combine(work, "data-ui-failed"), pub, "2.1.0", e, LocalTransport(e)), false);
            broken.StateChanged = delegate(string json) { heard.Add(json); };
            broken.HandlePageMessage(PageMessage.CheckUpdates);
            Is(true, Pump(delegate { return heard.Count >= 2; }, 8000), "a failing check finishes");
            Is(true, heard[1].Contains("\"phase\":\"failed\"") && heard[1].Contains("\"detail\":\""), "the page hears that it failed, and why");
            Is(false, broken.Bar.Visible, "the notice bar stays closed");
        }
    }

    static void UiChecks(string work)
    {
        if (!Environment.UserInteractive)
        {
            Console.WriteLine("(window checks skipped: this session is not interactive)");
            return;
        }
        MainFormChecks(work);
        using (Form form = new Form())
        {
            form.FormBorderStyle = FormBorderStyle.None;
            form.ShowInTaskbar = false;
            form.StartPosition = FormStartPosition.Manual;
            form.Location = new Point(-20000, -20000);
            form.ClientSize = new Size(900, 600);
            form.Opacity = 0;

            // exactly how MainForm composes it: the page first, the notice bar after it
            Panel page = new Panel();
            page.Dock = DockStyle.Fill;
            form.Controls.Add(page);
            UpdateBar bar = new UpdateBar(false);
            form.Controls.Add(bar);
            form.Show();
            form.PerformLayout();
            try
            {
                Is(false, bar.Visible, "the notice bar starts hidden");
                Is(true, page.Top == 0 && page.Height == 600, "with the bar hidden the page fills the window");

                int clicked = 0;
                bar.Display("HexShift 2.1.1 is available.", -1,
                    new BarButton("Release notes", delegate { clicked += 1; }),
                    new BarButton("Later", delegate { clicked += 10; }),
                    new BarButton("Download update", delegate { clicked += 100; }));
                form.PerformLayout();
                Is(true, bar.Visible && bar.Top == 0 && bar.Width == 900, "the bar docks across the top");
                Is(true, page.Top == bar.Height && page.Height == 600 - bar.Height, "the page fills what is left under the bar");
                List<Button> three = VisibleButtonsLeftToRight(bar);
                Same("Release notes|Later|Download update", Texts(three), "three choices run left to right");
                Is(true, three.Count == 3 && three[2].Right <= bar.Width && three[0].Left >= 0, "the buttons fit inside the bar");
                three[0].PerformClick();
                three[1].PerformClick();
                three[2].PerformClick();
                Is(true, clicked == 111, "each button runs its own action");

                bar.Display("Downloading HexShift 2.1.1... 40%", 40, new BarButton("Cancel", delegate { clicked += 1000; }));
                form.PerformLayout();
                List<Button> one = VisibleButtonsLeftToRight(bar);
                Same("Cancel", Texts(one), "a download shows only Cancel");
                Is(true, one.Count == 1 && one[0].Right <= bar.Width, "the lone button fits");
                one[0].PerformClick();
                Is(true, clicked == 1111, "Cancel runs its action");

                bar.Display("HexShift 2.1.1 is ready to install.", -1,
                    new BarButton("Later", delegate { }),
                    new BarButton("Restart and install", delegate { }));
                form.PerformLayout();
                Same("Later|Restart and install", Texts(VisibleButtonsLeftToRight(bar)), "two choices run left to right");

                bar.Dismiss();
                form.PerformLayout();
                Is(false, bar.Visible, "Dismiss hides the bar");
                Is(true, page.Top == 0 && page.Height == 600, "the page takes the space back");

                // the controller in a build with no update key: the page's commands, answered in the page, no dialogs
                string data = Path.Combine(work, "data-ui");
                UpdateService noKey = new UpdateService(data, null, "3.2.0", UpdateEndpoints.Release(), UpdateTransport.ForRelease());
                UpdateController controller = new UpdateController(form, noKey, false);
                List<string> told = new List<string>();
                controller.StateChanged = delegate(string json) { told.Add(json); };
                Is(true, controller.Bar != null, "the controller owns a bar");
                Is(false, controller.HandlePageMessage(PageMessage.None), "no message is not a command");
                Is(false, controller.HandlePageMessage(PageMessage.PickColour), "the screen picker is not an update command");
                Is(true, told.Count == 0, "...and the page is told nothing");
                Is(true, UpdateSettings.Load(data).AutoCheck, "automatic checks start on");
                Is(true, controller.HandlePageMessage(PageMessage.AutoUpdatesOff), "the off command is handled");
                Is(false, UpdateSettings.Load(data).AutoCheck, "...and switches it off, saved");
                Is(true, told.Count == 1 && told[0].Contains("\"auto\":false"), "...and the page is told");
                Is(true, controller.HandlePageMessage(PageMessage.AutoUpdatesOn), "the on command is handled");
                Is(true, UpdateSettings.Load(data).AutoCheck, "...and switches it back on, saved");
                Is(true, told.Count == 2 && told[1].Contains("\"auto\":true"), "...and the page is told");
                Is(true, controller.HandlePageMessage(PageMessage.UpdateState) && told.Count == 3 && told[2].Contains("\"phase\":\"idle\""), "a state request is answered");
                Is(true, told[2].Contains("\"enabled\":false"), "...saying updates are off in a build without a key");
                Is(true, controller.HandlePageMessage(PageMessage.CheckUpdates) && told.Count == 4, "a check without a key is answered");
                Is(true, told[3].Contains("\"phase\":\"failed\"") && told[3].Contains("not available in this build") && told[3].Contains("\"manual\":true"), "...as a failure the page can show, not a message box");
                controller.StartAutomaticChecks(); // no key, so nothing starts
                controller.Cancel();

                ControllerPhaseChecks(work, form);
            }
            finally { form.Close(); }
        }
    }
}
