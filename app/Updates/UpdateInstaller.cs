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

            transport.GetToFile(offer.Url, delegate(string url) { return endpoints.IsInstaller(url, version); }, part, offer.Size, UpdatePolicy.MaxInstallerBytes, progress, token);
            try
            {
                if (!UpdateFeed.Verifies(offer.Signature, File.ReadAllBytes(part), publicKey))
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

        // Only ever our own earlier downloads: installer names and half-finished parts.
        static void Tidy(string folder)
        {
            try
            {
                foreach (string file in Directory.GetFiles(folder))
                {
                    string name = Path.GetFileName(file);
                    if (name.StartsWith("HexShift-", StringComparison.Ordinal) && (name.EndsWith("-Setup.exe", StringComparison.Ordinal) || name.EndsWith("-Setup.exe.part", StringComparison.Ordinal)))
                        File.Delete(file);
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
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
