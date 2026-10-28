using System;
using Microsoft.Win32;

namespace HexShift
{
    // The Windows colours the page's System theme follows: the accent colour and
    // whether apps use dark mode. The host sends them to the page as data only;
    // the page never asks, and sends nothing back.
    static class SystemColours
    {
        internal const string Type = "system-colours";

        // DWM keeps the accent as 0xAABBGGRR.
        internal static string FromAbgr(int abgr)
        {
            uint v = unchecked((uint)abgr);
            return "#" + (v & 0xFF).ToString("X2") + ((v >> 8) & 0xFF).ToString("X2") + ((v >> 16) & 0xFF).ToString("X2");
        }

        // The message for the page; a missing or malformed accent is sent as null.
        internal static string Message(string accent, bool dark)
        {
            bool valid = accent != null && accent.Length == 7 && accent[0] == '#';
            for (int i = 1; valid && i < 7; i++) valid = Uri.IsHexDigit(accent[i]);
            return "{\"type\":\"" + Type + "\",\"accent\":" + (valid ? "\"" + accent.ToUpperInvariant() + "\"" : "null")
                + ",\"dark\":" + (dark ? "true" : "false") + "}";
        }

        internal static string Accent()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\DWM"))
                {
                    object v = k == null ? null : k.GetValue("AccentColor");
                    if (v is int) return FromAbgr((int)v);
                }
            }
            catch (Exception) { }
            return null;
        }

        internal static bool AppsUseDarkMode()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                {
                    object v = k == null ? null : k.GetValue("AppsUseLightTheme");
                    return v is int && (int)v == 0;
                }
            }
            catch (Exception) { return false; }
        }

        internal static string Current()
        {
            return Message(Accent(), AppsUseDarkMode());
        }
    }
}
