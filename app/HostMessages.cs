// Hex Shift - what the page may say to the host, and what the host tells the page about updates.
//
// The page can send the host a handful of exact words and nothing else, and only from the app's own
// document. What the host sends back is built here from fixed fields, never from text the page
// supplied. Nothing in this file touches the window, so each rule can be checked on its own.
//
// C# 5 on purpose, like the rest of the host.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;

namespace HexShift
{
    enum PageMessage { None, PickColour, CheckUpdates, AutoUpdatesOn, AutoUpdatesOff, UpdateState }

    static class HostMessages
    {
        // The page's words, exact and case-sensitive. "pick-colour" starts the screen picker
        // (ScreenPicker.cs); the rest drive the update check the page shows in its status bar and Help menu.
        internal static PageMessage Parse(string source, string message)
        {
            if (message == null || !MainForm.IsAppDocument(source)) return PageMessage.None;
            switch (message)
            {
                case "pick-colour": return PageMessage.PickColour;
                case "check-updates": return PageMessage.CheckUpdates;
                case "auto-updates-on": return PageMessage.AutoUpdatesOn;
                case "auto-updates-off": return PageMessage.AutoUpdatesOff;
                case "update-state": return PageMessage.UpdateState;
            }
            return PageMessage.None;
        }
    }

    // {"type":"update-state","phase":...}: where the update check stands, for the page's status bar
    // and Help menu. The phases are idle (nothing has happened yet), checking, current (up to date),
    // available, downloading, ready (downloaded, waiting for the person) and failed.
    static class UpdateState
    {
        internal const string Idle = "idle";
        internal const string Checking = "checking";
        internal const string Current = "current";
        internal const string Available = "available";
        internal const string Downloading = "downloading";
        internal const string Ready = "ready";
        internal const string Failed = "failed";

        // version: the running version when current, the offered one otherwise (or null).
        // checkedAt: when the last successful check finished, in UTC (null if none has).
        // manual: the person asked for this check, so the page can say more than it does for an automatic one.
        // detail: a sentence for a failure. percent: the download so far.
        internal static string Json(string phase, string version, DateTime lastCheckUtc, bool auto, bool enabled, bool manual, string detail, int percent)
        {
            Dictionary<string, object> state = new Dictionary<string, object>();
            state["type"] = "update-state";
            state["phase"] = phase;
            state["version"] = version;
            state["checkedAt"] = lastCheckUtc == DateTime.MinValue ? null : lastCheckUtc.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);
            state["auto"] = auto;
            state["enabled"] = enabled;
            state["manual"] = manual;
            if (detail != null) state["detail"] = detail;
            if (phase == Downloading) state["percent"] = percent;
            return new JavaScriptSerializer().Serialize(state);
        }
    }
}
