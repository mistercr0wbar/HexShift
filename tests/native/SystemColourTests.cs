// Checks for the System theme's message: the Windows accent read from DWM's
// 0xAABBGGRR value, and the one message shape the host sends the page.
//
// C# 5, like the host.

using System;
using HexShift;

static class SystemColourTests
{
    static int checks;
    static void Check(bool value, string label) { if (!value) throw new Exception(label); checks++; }

    internal static int Run()
    {
        Check(SystemColours.FromAbgr(unchecked((int)0xFF3A3A3A)) == "#3A3A3A", "Graphite accent");
        Check(SystemColours.FromAbgr(unchecked((int)0xFFD47800)) == "#0078D4", "Windows blue is stored blue-green-red");
        Check(SystemColours.FromAbgr(0x002E80E8) == "#E8802E", "Alpha is ignored");
        Check(SystemColours.Message("#0078d4", true) == "{\"type\":\"system-colours\",\"accent\":\"#0078D4\",\"dark\":true}", "Message with an accent");
        Check(SystemColours.Message("#0078D4", false) == "{\"type\":\"system-colours\",\"accent\":\"#0078D4\",\"dark\":false}", "Light app mode");
        foreach (string bad in new[] { null, "", "#12345", "#1234567", "0078D4", "#GG0000", "#12\"},x" })
            Check(SystemColours.Message(bad, true) == "{\"type\":\"system-colours\",\"accent\":null,\"dark\":true}", "No accent: " + bad);
        string live = SystemColours.Current();
        Check(live.StartsWith("{\"type\":\"system-colours\",\"accent\":") && (live.EndsWith("\"dark\":true}") || live.EndsWith("\"dark\":false}")), "Reads this PC's colours");
        return checks;
    }
}
