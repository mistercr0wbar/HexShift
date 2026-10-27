// Hex Shift - the screen colour picker for the Windows app.
//
// WebView2 has the browser's EyeDropper API but refuses to open it (every call is
// cancelled within a few milliseconds), so the page asks the host instead. It posts the
// one message "pick-colour"; the host takes a picture of every screen, lays it over that
// screen with a magnifier under the cursor, and answers with the colour the user clicks,
// or null for Esc. Only that one colour reaches the page. The pictures stay in the host
// and are thrown away as soon as the picker closes.
//
// C# 5 on purpose, like the rest of the host.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace HexShift
{
    static class ScreenPick
    {
        internal const string Request = "pick-colour";

        // The only message the page may send: this exact text, from the app's own document.
        internal static bool IsRequest(string source, string message)
        {
            return message == Request && MainForm.IsAppDocument(source);
        }

        internal static string Hex(Color c)
        {
            return "#" + c.R.ToString("X2") + c.G.ToString("X2") + c.B.ToString("X2");
        }

        // {"type":"picked-colour","hex":"#RRGGBB"}, with null when nothing was picked.
        internal static string Reply(string hex)
        {
            bool valid = hex != null && hex.Length == 7 && hex[0] == '#';
            for (int i = 1; valid && i < 7; i++) valid = Uri.IsHexDigit(hex[i]);
            return "{\"type\":\"picked-colour\",\"hex\":" + (valid ? "\"" + hex.ToUpperInvariant() + "\"" : "null") + "}";
        }

        // The magnifier sits below and right of the cursor, flipped to stay on its screen.
        internal static Point LensOrigin(Point cursor, Size lens, Size area, int gap)
        {
            int x = cursor.X + gap, y = cursor.Y + gap;
            if (x + lens.Width > area.Width) x = cursor.X - gap - lens.Width;
            if (y + lens.Height > area.Height) y = cursor.Y - gap - lens.Height;
            return new Point(Math.Max(0, x), Math.Max(0, y));
        }
    }

    // One pick: an overlay per screen, all closed together when it ends.
    sealed class ScreenPicker
    {
        readonly List<PickerOverlay> overlays = new List<PickerOverlay>();
        Action<string> done;
        int started;

        internal bool Busy { get { return done != null; } }

        internal void Start(Action<string> whenDone)
        {
            if (!Begin(whenDone)) return;
            try
            {
                // Every picture is taken before any overlay shows, so none of them is in one.
                foreach (Screen screen in Screen.AllScreens)
                {
                    Rectangle b = screen.Bounds;
                    Bitmap shot = new Bitmap(b.Width, b.Height, PixelFormat.Format32bppRgb);
                    try { using (Graphics g = Graphics.FromImage(shot)) g.CopyFromScreen(b.Location, Point.Empty, b.Size); }
                    catch (Exception) { shot.Dispose(); throw; }
                    Add(b, shot);
                }
            }
            catch (Exception) { Finish(null); return; }
            foreach (PickerOverlay o in overlays) o.Show();
            // Esc, Enter and the arrow keys go to the screen under the cursor.
            foreach (PickerOverlay o in overlays) if (o.Area.Contains(Cursor.Position)) o.Activate();
        }

        internal bool Begin(Action<string> whenDone)
        {
            if (done != null) return false;
            done = whenDone;
            started = Environment.TickCount;
            return true;
        }

        internal void Add(Rectangle bounds, Bitmap shot)
        {
            overlays.Add(new PickerOverlay(this, bounds, shot));
        }

        // A click within this long of opening is the end of the click that opened it.
        internal bool JustOpened { get { return unchecked(Environment.TickCount - started) < 300; } }

        // The colour at a point on the virtual screen, from the pictures; null off every screen.
        internal string ColourAt(Point screen)
        {
            foreach (PickerOverlay o in overlays)
                if (o.Area.Contains(screen)) return ScreenPick.Hex(o.Pixel(screen.X - o.Area.X, screen.Y - o.Area.Y));
            return null;
        }

        internal void Finish(string hex)
        {
            if (done == null) return;
            Action<string> callback = done;
            done = null;
            foreach (PickerOverlay o in overlays) { o.Close(); o.Dispose(); }
            overlays.Clear();
            callback(hex);
        }

        // Switching to another app (Alt+Tab, the Windows key) cancels; moving between screens does not.
        internal void CheckActive()
        {
            foreach (PickerOverlay o in overlays) if (Form.ActiveForm == o) return;
            Finish(null);
        }
    }

    sealed class PickerOverlay : Form
    {
        const int Span = 11, Gap = 20;
        const string Hint = "   Esc cancels";

        // The screen this overlay covers, in physical pixels on the virtual screen.
        internal Rectangle Area { get { return area; } }
        readonly Rectangle area;
        readonly ScreenPicker picker;
        readonly Bitmap shot;
        bool pressed;
        Point? cursor;
        int zoom = 16, label = 30;
        Font font;

        [DllImport("user32.dll")]
        static extern int GetDpiForWindow(IntPtr hwnd);

        internal PickerOverlay(ScreenPicker picker, Rectangle bounds, Bitmap shot)
        {
            this.picker = picker;
            this.shot = shot;
            area = bounds;
            Text = "Pick a colour";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            Bounds = bounds;
            ShowInTaskbar = false;
            TopMost = true;
            Cursor = Cursors.Cross;
            BackColor = Color.Black;
            DoubleBuffered = true;
        }

        internal Color Pixel(int x, int y)
        {
            return x >= 0 && y >= 0 && x < shot.Width && y < shot.Height ? shot.GetPixel(x, y) : Color.Black;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            // The magnifier keeps the same size on screen at any display scale.
            int dpi = 96;
            try { dpi = Math.Max(96, GetDpiForWindow(Handle)); } catch (Exception) { }
            label = 30 * dpi / 96;
            font = new Font("Segoe UI", 13f * dpi / 96, FontStyle.Bold, GraphicsUnit.Pixel);
            // Wide enough for the swatch and "#RRGGBB   Esc cancels" under the grid.
            int text = TextRenderer.MeasureText("#DDDDDD" + Hint, font).Width + label;
            zoom = Math.Max(12 * dpi / 96, (text + Span - 1) / Span);
        }

        Rectangle Lens(Point at)
        {
            Size size = new Size(Span * zoom + 4, Span * zoom + 4 + label);
            return new Rectangle(ScreenPick.LensOrigin(at, size, ClientSize, Gap), size);
        }

        void MoveLens(Point? at)
        {
            if (cursor.HasValue) Invalidate(Lens(cursor.Value));
            cursor = at;
            if (at.HasValue) Invalidate(Lens(at.Value));
        }

        // The picture covers everything, so there is no background to paint.
        protected override void OnPaintBackground(PaintEventArgs e) { }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            // Pixel for pixel: no smoothing, so the frozen screen looks exactly like the real one.
            g.InterpolationMode = InterpolationMode.NearestNeighbor;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            g.DrawImage(shot, e.ClipRectangle, e.ClipRectangle, GraphicsUnit.Pixel);
            if (!cursor.HasValue) return;
            Point at = cursor.Value;
            Rectangle r = Lens(at);
            g.FillRectangle(Brushes.Black, r);
            g.DrawRectangle(Pens.White, r.X + 1, r.Y + 1, r.Width - 3, r.Height - 3);
            int left = r.X + 2, top = r.Y + 2, half = Span / 2;
            for (int y = 0; y < Span; y++)
                for (int x = 0; x < Span; x++)
                    using (SolidBrush b = new SolidBrush(Pixel(at.X - half + x, at.Y - half + y)))
                        g.FillRectangle(b, left + x * zoom, top + y * zoom, zoom, zoom);
            // The pixel that a click picks, outlined in black and white so it shows on any colour.
            Rectangle centre = new Rectangle(left + half * zoom, top + half * zoom, zoom, zoom);
            g.DrawRectangle(Pens.Black, centre.X - 1, centre.Y - 1, centre.Width + 1, centre.Height + 1);
            g.DrawRectangle(Pens.White, centre.X, centre.Y, centre.Width - 1, centre.Height - 1);
            Color c = Pixel(at.X, at.Y);
            int text = top + Span * zoom;
            using (SolidBrush swatch = new SolidBrush(c)) g.FillRectangle(swatch, left + 4, text + 6, label - 12, label - 12);
            TextRenderer.DrawText(g, ScreenPick.Hex(c) + Hint, font, new Rectangle(left + label - 2, text, r.Right - left - label, label), Color.White, Color.Black, TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            MoveLens(e.Location);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            MoveLens(null);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            pressed = !picker.JustOpened;
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (!pressed) return;
            pressed = false;
            if (e.Button == MouseButtons.Left) picker.Finish(ScreenPick.Hex(Pixel(e.X, e.Y)));
            else if (e.Button == MouseButtons.Right) picker.Finish(null);
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keys)
        {
            int step = (keys & Keys.Shift) != 0 ? 10 : 1;
            switch (keys & Keys.KeyCode)
            {
                case Keys.Escape: picker.Finish(null); return true;
                case Keys.Enter:
                case Keys.Space: picker.Finish(picker.ColourAt(Cursor.Position)); return true;
                case Keys.Left: Nudge(-step, 0); return true;
                case Keys.Right: Nudge(step, 0); return true;
                case Keys.Up: Nudge(0, -step); return true;
                case Keys.Down: Nudge(0, step); return true;
            }
            return base.ProcessCmdKey(ref msg, keys);
        }

        static void Nudge(int dx, int dy)
        {
            Point p = Cursor.Position;
            Cursor.Position = new Point(p.X + dx, p.Y + dy);
        }

        protected override void OnDeactivate(EventArgs e)
        {
            base.OnDeactivate(e);
            // Wait until the new window is active: another overlay keeps the pick going.
            if (picker.Busy && IsHandleCreated) BeginInvoke(new Action(picker.CheckActive));
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            base.OnFormClosed(e);
            picker.Finish(null);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                shot.Dispose();
                if (font != null) font.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
