// Hex Shift - keeping and running a downloaded installer.
//
// The installer is downloaded into one folder of ours, checked against the signature
// in the signed feed, and checked again, while held open and locked against changes,
// at the moment it is started. The command line is fixed by the caller, never taken
// from the feed.
//
// C# 5 on purpose, like the rest of the host.

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace HexShift
{
    static class UpdateInstaller
    {
        // Downloads the offered installer and keeps it only if it is exactly what the signed feed
        // described. Returns the path of the verified file.
        internal static string Stage(UpdateTransport transport, UpdateEndpoints endpoints, UpdateOffer offer, string dataDir, byte[] publicKey, Action<long, long> progress, CancellationToken token)
        {
            string folder = UpdatePolicy.StagingFolder(dataDir);
            Program.RejectRedirects(folder);
            Directory.CreateDirectory(folder);
            Program.RejectRedirects(folder);
            Tidy(folder);

            string final = Path.Combine(folder, "HexShift-" + offer.Version + "-Setup.exe");
            if (!UpdatePolicy.IsStagedInstaller(folder, final, offer.Version))
                throw new UpdateException("HexShift could not choose a safe place for the update.");
            string part = final + ".part";
            string version = offer.Version;

            transport.GetToFile(offer.Url, endpoints.ForInstaller(version), part, offer.Size, UpdatePolicy.MaxInstallerBytes, progress, token);
            try
            {
                if (!UpdateFeed.Verifies(offer.Signature, ReadWhole(part, offer.Size), publicKey))
                    throw new UpdateException("The downloaded installer's signature did not check out, so it was discarded.");
                File.Move(part, final);
            }
            catch
            {
                try { File.Delete(part); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                throw;
            }
            return final;
        }

        // The file opened once, locked against writes, and read to exactly the length the signed feed
        // promised, so a file swapped in after the download cannot make this allocate more.
        static byte[] ReadWhole(string path, long expectedLength)
        {
            using (FileStream file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (file.Length != expectedLength) throw new UpdateException("The downloaded installer is not the size the update information promised.");
                byte[] bytes = new byte[expectedLength];
                int total = 0;
                while (total < bytes.Length)
                {
                    int read = file.Read(bytes, total, bytes.Length - total);
                    if (read <= 0) throw new UpdateException("The downloaded installer could not be read back.");
                    total += read;
                }
                return bytes;
            }
        }

        // The staging folder belongs to the updater alone, so every file in it goes: earlier downloads,
        // half-finished parts, and anything somebody else dropped in to sit beside the installer.
        // Files only; subfolders are left alone because they could be junctions.
        static void Tidy(string folder)
        {
            try
            {
                foreach (string file in Directory.GetFiles(folder)) File.Delete(file);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern uint GetFinalPathNameByHandleW(IntPtr file, StringBuilder buffer, uint length, uint flags);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern uint GetLongPathNameW(string shortPath, StringBuilder buffer, uint length);

        // Where Windows says this open file really is: not what the path we were given resolves to
        // now, but where the handle we hold points. Null when it cannot be worked out.
        internal static string FinalPathOf(FileStream file)
        {
            StringBuilder buffer = new StringBuilder(1024);
            uint length = GetFinalPathNameByHandleW(file.SafeFileHandle.DangerousGetHandle(), buffer, (uint)buffer.Capacity, 0);
            if (length == 0 || length >= buffer.Capacity) return null;
            string path = buffer.ToString();
            return path.StartsWith(@"\\?\", StringComparison.Ordinal) && !path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase) ? path.Substring(4) : path;
        }

        // The same path with 8.3 short names written out in full, so it compares with FinalPathOf.
        internal static string LongForm(string path)
        {
            string full = Path.GetFullPath(path);
            StringBuilder buffer = new StringBuilder(1024);
            uint length = GetLongPathNameW(full, buffer, (uint)buffer.Capacity);
            return length == 0 || length >= buffer.Capacity ? full : buffer.ToString();
        }

        // True when the open file is exactly where we expect it, so a folder swapped for a junction
        // between the last check and the open is noticed.
        internal static bool IsAt(FileStream file, string expectedPath)
        {
            string actual = FinalPathOf(file);
            return actual != null && string.Equals(actual, LongForm(expectedPath), StringComparison.OrdinalIgnoreCase);
        }

        // Verifies the staged installer once more while holding it open (no writes, no deletion
        // by anyone else), then starts it with the given command line.
        internal static void Launch(string path, UpdateOffer offer, string dataDir, byte[] publicKey, string arguments)
        {
            string folder = UpdatePolicy.StagingFolder(dataDir);
            if (!UpdatePolicy.IsStagedInstaller(folder, path, offer.Version))
                throw new UpdateException("That file is not a staged HexShift installer.");
            Program.RejectRedirects(path);

            using (FileStream held = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (!IsAt(held, path)) throw new UpdateException("The downloaded installer is not where HexShift put it, so it was not run.");
                if (held.Length != offer.Size) throw new UpdateException("The downloaded installer is not the size the update information promised.");
                byte[] bytes = new byte[held.Length];
                int total = 0;
                while (total < bytes.Length)
                {
                    int read = held.Read(bytes, total, bytes.Length - total);
                    if (read <= 0) throw new UpdateException("The downloaded installer could not be read back.");
                    total += read;
                }
                if (!UpdateFeed.Verifies(offer.Signature, bytes, publicKey))
                    throw new UpdateException("The downloaded installer no longer matches its signature, so it was not run.");

                ProcessStartInfo info = new ProcessStartInfo(path);
                info.Arguments = arguments ?? "";
                info.UseShellExecute = false;
                info.WorkingDirectory = folder;
                using (Process.Start(info)) { }
            }
        }
    }
}
