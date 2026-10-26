// Hex Shift - the two update preferences.
//
// Whether to check automatically, and when it last happened. Kept in one small JSON file
// under the app's data folder. Anything wrong with the file, and the defaults apply.
//
// C# 5 on purpose, like the rest of the host.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace HexShift
{
    sealed class UpdateSettings
    {
        const int MaxBytes = 4096;

        internal bool AutoCheck = true;
        internal DateTime LastCheckUtc = DateTime.MinValue;

        static string PathIn(string dataDir)
        {
            return Path.Combine(dataDir, "update-settings.json");
        }

        // Never throws: a missing, oversized, redirected or unreadable file gives the defaults.
        internal static UpdateSettings Load(string dataDir)
        {
            UpdateSettings settings = new UpdateSettings();
            try
            {
                string path = PathIn(dataDir);
                Program.RejectRedirects(path);
                // Opened once and read with a hard stop, so a file swapped for a huge one after a
                // size check cannot be pulled into memory. A missing file throws and gives defaults.
                string text;
                using (FileStream file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    byte[] bytes = new byte[MaxBytes + 1];
                    int total = 0;
                    int read;
                    while (total < bytes.Length && (read = file.Read(bytes, total, bytes.Length - total)) > 0) total += read;
                    if (total > MaxBytes) return settings;
                    text = Encoding.UTF8.GetString(bytes, 0, total);
                }
                Dictionary<string, object> values = new JavaScriptSerializer().DeserializeObject(text) as Dictionary<string, object>;
                if (values == null) return settings;
                object auto;
                if (values.TryGetValue("autoCheck", out auto) && auto is bool) settings.AutoCheck = (bool)auto;
                object last;
                DateTime parsed;
                if (values.TryGetValue("lastCheckUtc", out last) && last is string
                    && DateTime.TryParse((string)last, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out parsed))
                    settings.LastCheckUtc = parsed;
            }
            catch (Exception) { return new UpdateSettings(); }
            return settings;
        }

        // One save at a time. The values are read INSIDE the lock, so a save that started before the
        // user switched automatic checks off cannot finish last with the old value and undo it.
        static readonly object saving = new object();

        // Best effort and atomic: a failed save only means the next start asks again.
        internal void Save(string dataDir)
        {
            lock (saving)
            {
                try
                {
                    string path = PathIn(dataDir);
                    Program.RejectRedirects(dataDir);
                    Directory.CreateDirectory(dataDir);
                    Program.RejectRedirects(path);
                    Dictionary<string, object> values = new Dictionary<string, object>();
                    values["autoCheck"] = AutoCheck;
                    values["lastCheckUtc"] = LastCheckUtc.ToString("o", CultureInfo.InvariantCulture);
                    string tmp = Path.Combine(dataDir, Guid.NewGuid().ToString("N") + ".tmp");
                    try
                    {
                        File.WriteAllText(tmp, new JavaScriptSerializer().Serialize(values), new UTF8Encoding(false));
                        if (File.Exists(path)) File.Replace(tmp, path, null); else File.Move(tmp, path);
                    }
                    finally { if (File.Exists(tmp)) File.Delete(tmp); }
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
    }
}
