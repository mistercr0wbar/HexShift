// Checks for the screen colour picker's rules: the one message the host accepts, the one
// reply it sends, where the magnifier goes, and reading colours from the pictures of two
// screens, one of them left of the main screen at negative coordinates. Nothing is shown
// and the real screen is never captured.
//
// C# 5, like the host.

using System;
using System.Drawing;
using System.Drawing.Imaging;
using HexShift;

static class PickerTests
{
    static int checks;
    static void Check(bool value, string label) { if (!value) throw new Exception(label); checks++; }

    internal static int Run()
    {
        Check(ScreenPick.IsRequest("https://hexshift.invalid/", "pick-colour"), "Picker request from the app");
        foreach (string message in new[] { null, "", "Pick-Colour", "pick-colour ", "{\"type\":\"pick-colour\"}", "open-file" })
            Check(!ScreenPick.IsRequest("https://hexshift.invalid/", message), "Other message ignored: " + message);
        foreach (string source in new[] { null, "https://evil/", "https://hexshift.invalid.evil/", "http://hexshift.invalid/", "about:blank" })
            Check(!ScreenPick.IsRequest(source, "pick-colour"), "Request from elsewhere ignored: " + source);
        Check(ScreenPick.Hex(Color.FromArgb(0x58, 0x65, 0xF2)) == "#5865F2", "Hex of a colour");
        Check(ScreenPick.Reply("#5865f2") == "{\"type\":\"picked-colour\",\"hex\":\"#5865F2\"}", "Reply with a colour");
        foreach (string bad in new[] { null, "", "#12345", "#1234567", "5865F2", "#GG0000", "#12\"},x" })
            Check(ScreenPick.Reply(bad) == "{\"type\":\"picked-colour\",\"hex\":null}", "Reply without a colour: " + bad);

        Size lens = new Size(100, 120), screen = new Size(1920, 1080);
        Check(ScreenPick.LensOrigin(new Point(10, 10), lens, screen, 20) == new Point(30, 30), "Magnifier below right of the cursor");
        Check(ScreenPick.LensOrigin(new Point(1900, 1070), lens, screen, 20) == new Point(1780, 930), "Magnifier flips near the corner");
        Check(ScreenPick.LensOrigin(new Point(50, 50), new Size(400, 2000), screen, 20) == new Point(70, 0), "Magnifier stays on its screen");

        ScreenPicker picker = new ScreenPicker();
        string got = "unset";
        int calls = 0;
        Check(picker.Begin(delegate(string hex) { got = hex; calls++; }), "Pick begins");
        Check(!picker.Begin(delegate(string hex) { }), "Only one pick at a time");
        picker.Add(new Rectangle(-4, 0, 4, 3), Solid(4, 3, Color.FromArgb(0x24, 0x80, 0x46)));
        Bitmap main = Solid(5, 3, Color.White);
        main.SetPixel(2, 1, Color.FromArgb(0xFF, 0x2A, 0x80));
        picker.Add(new Rectangle(0, 0, 5, 3), main);
        Check(picker.ColourAt(new Point(-1, 2)) == "#248046", "Colour on the left screen");
        Check(picker.ColourAt(new Point(2, 1)) == "#FF2A80", "Colour on the main screen");
        Check(picker.ColourAt(new Point(0, 0)) == "#FFFFFF", "Main screen's top left corner");
        Check(picker.ColourAt(new Point(5, 0)) == null && picker.ColourAt(new Point(-5, 0)) == null, "Off every screen");
        picker.Finish("#FF2A80");
        picker.Finish(null);
        Check(calls == 1 && got == "#FF2A80" && !picker.Busy, "One answer per pick");
        Check(picker.ColourAt(new Point(2, 1)) == null, "Pictures are let go after the pick");
        Check(picker.Begin(delegate(string hex) { }), "A new pick can start");
        picker.Finish(null);
        return checks;
    }

    static Bitmap Solid(int w, int h, Color c)
    {
        Bitmap b = new Bitmap(w, h, PixelFormat.Format32bppRgb);
        using (Graphics g = Graphics.FromImage(b)) g.Clear(c);
        return b;
    }
}
