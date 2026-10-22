// Smoke checks for the notice bar and the controller's menu handling: the layout the way
// MainForm composes it (page first, bar second, so Fill still gets the rest), the order and
// action of the buttons, and the automatic-check preference behind the system menu.
//
// The window is borderless, fully transparent, off-screen and out of the taskbar, and it
// lives for a fraction of a second. Nothing here opens a dialog: "Check for updates" is not
// exercised because it would show a message box.
//
// C# 5, like the host.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
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

    static void UiChecks(string work)
    {
        if (!Environment.UserInteractive) return;
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

                // the controller: preference behind the system menu, no dialogs
                string data = Path.Combine(work, "data-ui");
                UpdateController controller = new UpdateController(form, data, false);
                Is(true, controller.Bar != null, "the controller owns a bar");
                controller.AttachSystemMenu(form.Handle);
                Is(false, controller.HandleSysCommand((IntPtr)0xF060), "Windows' own system commands are left alone");
                Is(false, controller.HandleSysCommand((IntPtr)0x0000), "no command is not ours");
                Is(true, UpdateSettings.Load(data).AutoCheck, "automatic checks start on");
                Is(true, controller.HandleSysCommand((IntPtr)0x1010), "the automatic-check command is handled");
                Is(false, UpdateSettings.Load(data).AutoCheck, "...and switches it off, saved");
                Is(true, controller.HandleSysCommand((IntPtr)0x1013), "the low four bits Windows adds are ignored");
                Is(true, UpdateSettings.Load(data).AutoCheck, "...and switches it back on, saved");
                controller.StartAutomaticCheck();
                controller.Cancel();
                passed++;
            }
            finally { form.Close(); }
        }
    }
}
