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
                FileInfo info = new FileInfo(path);
                if (!info.Exists || info.Length > MaxBytes) return settings;
                Dictionary<string, object> values = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
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

        // Best effort and atomic: a failed save only means the next start asks again.
        internal void Save(string dataDir)
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
