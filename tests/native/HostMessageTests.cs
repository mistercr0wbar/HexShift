// Checks for what the page may say to the host (a few exact words, from the app's own document, and
// nothing else) and for the update-state message the host sends back. Nothing here opens a window.
//
// C# 5, like the host.

using System;
using HexShift;

static class HostMessageTests
{
    static int checks;
    static void Check(bool value, string label) { if (!value) throw new Exception(label); checks++; }

    internal static int Run()
    {
        string app = "https://hexshift.invalid/";
        Check(HostMessages.Parse(app, "pick-colour") == PageMessage.PickColour, "pick-colour from the app");
        Check(HostMessages.Parse(app, "check-updates") == PageMessage.CheckUpdates, "check-updates from the app");
        Check(HostMessages.Parse(app, "auto-updates-on") == PageMessage.AutoUpdatesOn, "auto-updates-on from the app");
        Check(HostMessages.Parse(app, "auto-updates-off") == PageMessage.AutoUpdatesOff, "auto-updates-off from the app");
        Check(HostMessages.Parse(app, "update-state") == PageMessage.UpdateState, "update-state from the app");
        Check(HostMessages.Parse("https://hexshift.invalid/index.html", "update-state") == PageMessage.UpdateState, "the app's index document counts too");

        // Exact words only: no other case, no spacing, no JSON, no lists, nothing the page might invent.
        foreach (string word in new[] { null, "", "Check-Updates", "CHECK-UPDATES", "check-updates ", " check-updates", "check_updates", "{\"type\":\"check-updates\"}",
            "update-state\n", "auto-updates", "auto-updates-on;auto-updates-off", "pick-colour,check-updates", "exit", "close", "open-file", "install", "download" })
            Check(HostMessages.Parse(app, word) == PageMessage.None, "Other words ignored: " + word);

        // And only from the app's own document.
        foreach (string source in new[] { null, "", "https://evil/", "https://hexshift.invalid.evil/", "http://hexshift.invalid/", "about:blank",
            "file:///C:/x.html", "https://hexshift.invalid:444/", "https://user@hexshift.invalid/", "https://hexshift.invalid/other" })
            foreach (string word in new[] { "pick-colour", "check-updates", "auto-updates-on", "auto-updates-off", "update-state" })
                Check(HostMessages.Parse(source, word) == PageMessage.None, "From elsewhere ignored: " + source + " " + word);

        // The state message is built from fixed fields.
        DateTime when = new DateTime(2026, 10, 28, 12, 30, 0, DateTimeKind.Utc);
        Check(UpdateState.Json(UpdateState.Current, "3.2.0", when, true, true, false, null, 0)
            == "{\"type\":\"update-state\",\"phase\":\"current\",\"version\":\"3.2.0\",\"checkedAt\":\"2026-10-28T12:30:00.0000000Z\",\"auto\":true,\"enabled\":true,\"manual\":false}",
            "an up-to-date state");
        string idle = UpdateState.Json(UpdateState.Idle, null, DateTime.MinValue, false, false, false, null, 0);
        Check(idle == "{\"type\":\"update-state\",\"phase\":\"idle\",\"version\":null,\"checkedAt\":null,\"auto\":false,\"enabled\":false,\"manual\":false}", "a state before any check: " + idle);
        string failed = UpdateState.Json(UpdateState.Failed, null, DateTime.MinValue, true, true, true, "It said \"no\"\n", 0);
        Check(failed.Contains("\"phase\":\"failed\"") && failed.Contains("\"manual\":true") && failed.Contains("\"detail\":\"It said \\\"no\\\"\\n\""), "a failure carries its sentence, escaped: " + failed);
        Check(!UpdateState.Json(UpdateState.Current, "3.2.0", when, true, true, false, null, 0).Contains("detail"), "no detail without one");
        string downloading = UpdateState.Json(UpdateState.Downloading, "3.2.1", when, true, true, false, null, 42);
        Check(downloading.Contains("\"percent\":42") && downloading.Contains("\"version\":\"3.2.1\""), "a download reports its percent");
        Check(!UpdateState.Json(UpdateState.Available, "3.2.1", when, true, true, false, null, 42).Contains("percent"), "only a download has a percent");
        return checks;
    }
}
