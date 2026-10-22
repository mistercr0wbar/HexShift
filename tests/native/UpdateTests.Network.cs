// The server-backed half of the update checks: a loopback HTTP server stands in for
// thecr0wbar.xyz, GitHub and its CDN, and a tiny compiled "installer" records how it
// was started. Nothing here leaves this PC or touches the real HexShift install.
//
// C# 5, like the host.

using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using Microsoft.CSharp;
using HexShift;

static partial class UpdateTests
{
    // ---- a loopback server -------------------------------------------------------

    sealed class TestServer : IDisposable
    {
        readonly HttpListener listener = new HttpListener();
        readonly Dictionary<string, Action<HttpListenerContext>> routes = new Dictionary<string, Action<HttpListenerContext>>();
        readonly Dictionary<string, int> hits = new Dictionary<string, int>();
        internal readonly string Base;
        internal int Requests;

        internal TestServer()
        {
            for (int port = 40100; ; port++)
            {
                try
                {
                    listener.Prefixes.Clear();
                    listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
                    listener.Start();
                    Base = "http://127.0.0.1:" + port;
                    break;
                }
                catch (HttpListenerException) { if (port > 40400) throw; }
            }
            Thread thread = new Thread(Loop);
            thread.IsBackground = true;
            thread.Start();
        }

        void Loop()
        {
            while (true)
            {
                HttpListenerContext context;
                try { context = listener.GetContext(); }
                catch (HttpListenerException) { return; }
                catch (ObjectDisposedException) { return; }
                catch (InvalidOperationException) { return; }
                Interlocked.Increment(ref Requests);
                ThreadPool.QueueUserWorkItem(delegate { Handle(context); });
            }
        }

        void Handle(HttpListenerContext context)
        {
            try
            {
                string path = context.Request.Url.AbsolutePath;
                Action<HttpListenerContext> route;
                lock (routes)
                {
                    int count;
                    hits.TryGetValue(path, out count);
                    hits[path] = count + 1;
                    routes.TryGetValue(path, out route);
                }
                if (route == null) { context.Response.StatusCode = 404; context.Response.Close(); return; }
                route(context);
            }
            catch (Exception) { try { context.Response.Abort(); } catch (Exception) { } }
        }

        internal int Hits(string path)
        {
            lock (routes) { int count; hits.TryGetValue(path, out count); return count; }
        }

        internal void Route(string path, Action<HttpListenerContext> handler)
        {
            lock (routes) { routes[path] = handler; }
        }

        internal void Body(string path, byte[] body, bool chunked)
        {
            Route(path, delegate(HttpListenerContext c)
            {
                c.Response.StatusCode = 200;
                if (chunked) c.Response.SendChunked = true; else c.Response.ContentLength64 = body.Length;
                c.Response.OutputStream.Write(body, 0, body.Length);
                c.Response.Close();
            });
        }

        internal void Status(string path, int status)
        {
            Route(path, delegate(HttpListenerContext c) { c.Response.StatusCode = status; c.Response.Close(); });
        }

        internal void Redirect(string path, string location, int status)
        {
            Route(path, delegate(HttpListenerContext c) { c.Response.StatusCode = status; c.Response.RedirectLocation = location; c.Response.Close(); });
        }

        // Promises more bytes than it sends, then drops the connection.
        internal void Short(string path, long declared, byte[] actual)
        {
            Route(path, delegate(HttpListenerContext c)
            {
                c.Response.ContentLength64 = declared;
                c.Response.OutputStream.Write(actual, 0, actual.Length);
                c.Response.OutputStream.Flush();
                c.Response.Abort();
            });
        }

        internal long Written;

        // Streams up to totalBytes in 64 KB pieces with no announced length, and counts what it
        // managed to send. A client that stops reading early makes a write fail and ends the stream.
        internal void Endless(string path, long totalBytes)
        {
            Route(path, delegate(HttpListenerContext c)
            {
                Interlocked.Exchange(ref Written, 0);
                c.Response.StatusCode = 200;
                c.Response.SendChunked = true;
                byte[] piece = new byte[64 * 1024];
                try
                {
                    for (long sent = 0; sent < totalBytes; sent += piece.Length)
                    {
                        c.Response.OutputStream.Write(piece, 0, piece.Length);
                        c.Response.OutputStream.Flush();
                        Interlocked.Add(ref Written, piece.Length);
                    }
                    c.Response.Close();
                }
                catch (Exception) { try { c.Response.Abort(); } catch (Exception) { } }
            });
        }

        // Sends a little, then stalls for a while.
        internal void Slow(string path)
        {
            Route(path, delegate(HttpListenerContext c)
            {
                c.Response.ContentLength64 = 100;
                c.Response.OutputStream.Write(new byte[10], 0, 10);
                c.Response.OutputStream.Flush();
                Thread.Sleep(6000);
                c.Response.Abort();
            });
        }

        public void Dispose()
        {
            try { listener.Stop(); listener.Close(); } catch (Exception) { }
        }
    }

    // The service pointed at a server instead of the real sites, with the same shape of rules.
    static UpdateEndpoints Local(string baseUrl)
    {
        UpdateEndpoints e = new UpdateEndpoints();
        e.FeedUrl = baseUrl + "/updates/appcast.json";
        e.IsFeed = delegate(string u) { return u == baseUrl + "/updates/appcast.json" || u == baseUrl + "/updates/appcast.json.signature"; };
        e.IsInstaller = delegate(string u, string v) { return UpdatePolicy.IsVersion(v) && u == baseUrl + "/dl/HexShift-" + v + "-Setup.exe"; };
        e.IsRedirect = delegate(string u) { return u.StartsWith(baseUrl + "/cdn/", StringComparison.Ordinal); };
        return e;
    }

    static UpdateTransport LocalTransport(UpdateEndpoints e)
    {
        return new UpdateTransport(e.IsRedirect, UpdatePolicy.MaxRedirects, "HexShiftTest");
    }

    static void NetworkChecks(string work)
    {
        TransportChecks(work);
        EndToEnd(work);
    }

    // ---- guarded downloads -------------------------------------------------------

    // How many bytes the endless route got out, once that number stops moving.
    static long Settled(TestServer s)
    {
        long last = -1;
        for (int i = 0; i < 40; i++)
        {
            Thread.Sleep(100);
            long now = Interlocked.Read(ref s.Written);
            if (now == last) return now;
            last = now;
        }
        return last;
    }

    static void TransportChecks(string work)
    {
        using (TestServer s = new TestServer())
        {
            UpdateEndpoints e = Local(s.Base);
            UpdateTransport t = LocalTransport(e);
            CancellationToken none = CancellationToken.None;
            string feed = s.Base + "/updates/appcast.json";
            byte[] hello = Encoding.ASCII.GetBytes("hello");

            s.Body("/updates/appcast.json", hello, false);
            Same("hello", Encoding.ASCII.GetString(t.GetBytes(feed, e.IsFeed, 1000, none)), "fetches a small response");

            // size ceilings, whether or not the server announces a length
            s.Body("/updates/appcast.json", new byte[2000], false);
            Raises<UpdateException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, none); }, "announced length over the ceiling");
            s.Body("/updates/appcast.json", new byte[2000], true);
            Raises<UpdateException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, none); }, "chunked body over the ceiling");
            s.Body("/updates/appcast.json", new byte[1000], true);
            Is(true, t.GetBytes(feed, e.IsFeed, 1000, none).Length == 1000, "a body exactly at the ceiling is fine");

            // a stream that never ends is cut off almost at once, not read to the end
            s.Endless("/updates/appcast.json", 40L * 1024 * 1024);
            Raises<UpdateException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, none); }, "an endless stream over the in-memory ceiling");
            Is(true, Settled(s) < 8L * 1024 * 1024, "the server was cut off long before 40 MB (in memory)");

            s.Status("/updates/appcast.json", 500);
            Raises<UpdateException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, none); }, "server error");
            s.Status("/updates/appcast.json", 404);
            Raises<UpdateException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, none); }, "not found");
            s.Status("/updates/appcast.json", 204);
            Raises<UpdateException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, none); }, "a success status other than 200");

            // the first address must pass the caller's rule before any request is made
            int before = s.Requests;
            Raises<UpdateException>(delegate { t.GetBytes(s.Base + "/other", e.IsFeed, 1000, none); }, "first address not allowed");
            Raises<UpdateException>(delegate { t.GetBytes(null, e.IsFeed, 1000, none); }, "null address");
            Is(true, s.Requests == before, "refused addresses are never contacted");

            // redirects
            s.Redirect("/updates/appcast.json", "/cdn/a", 302);
            s.Redirect("/cdn/a", "/cdn/b", 301);
            s.Body("/cdn/b", hello, false);
            Same("hello", Encoding.ASCII.GetString(t.GetBytes(feed, e.IsFeed, 1000, none)), "follows allowed redirects (relative addresses)");
            s.Redirect("/cdn/a", s.Base + "/cdn/b", 307);
            Same("hello", Encoding.ASCII.GetString(t.GetBytes(feed, e.IsFeed, 1000, none)), "follows allowed redirects (absolute addresses)");

            s.Redirect("/cdn/a", "/evil/x", 302);
            s.Body("/evil/x", hello, false);
            Raises<UpdateException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, none); }, "redirect to an address the rule does not allow");
            Is(true, s.Hits("/evil/x") == 0, "a refused redirect is never followed");
            s.Redirect("/cdn/a", "file:///C:/Windows/win.ini", 302);
            Raises<UpdateException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, none); }, "redirect to a file address");
            s.Redirect("/cdn/a", "http://example.invalid/cdn/b", 302);
            Raises<UpdateException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, none); }, "redirect to another host");
            s.Route("/cdn/a", delegate(HttpListenerContext c) { c.Response.StatusCode = 302; c.Response.Close(); });
            Raises<UpdateException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, none); }, "redirect with no destination");

            s.Redirect("/updates/appcast.json", "/cdn/1", 302);
            s.Redirect("/cdn/1", "/cdn/2", 302);
            s.Redirect("/cdn/2", "/cdn/3", 302);
            s.Body("/cdn/3", hello, false);
            Same("hello", Encoding.ASCII.GetString(t.GetBytes(feed, e.IsFeed, 1000, none)), "three redirects are allowed");
            s.Redirect("/cdn/3", "/cdn/4", 302);
            s.Body("/cdn/4", hello, false);
            Raises<UpdateException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, none); }, "four redirects are too many");
            s.Redirect("/cdn/1", "/cdn/1", 302);
            Raises<UpdateException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, none); }, "a redirect loop ends");

            // cancelling stops a stalled download promptly
            s.Slow("/updates/appcast.json");
            CancellationTokenSource cts = new CancellationTokenSource();
            cts.CancelAfter(400);
            DateTime started = DateTime.UtcNow;
            Raises<OperationCanceledException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, cts.Token); }, "cancelling a stalled download");
            Is(true, DateTime.UtcNow - started < TimeSpan.FromSeconds(4), "cancellation does not wait for the server");
            CancellationTokenSource already = new CancellationTokenSource();
            already.Cancel();
            Raises<OperationCanceledException>(delegate { t.GetBytes(feed, e.IsFeed, 1000, already.Token); }, "already cancelled");

            // downloads to a file: exact length, deleted when anything is wrong
            byte[] payload = new byte[300000];
            new Random(7).NextBytes(payload);
            string dest = Path.Combine(work, "download.bin");
            string url = s.Base + "/dl/file";
            Func<string, bool> allowFile = delegate(string u) { return u == url; };

            s.Body("/dl/file", payload, false);
            List<long> seen = new List<long>();
            t.GetToFile(url, allowFile, dest, payload.Length, 1000000, delegate(long done, long total) { seen.Add(done); }, none);
            Is(true, File.Exists(dest) && File.ReadAllBytes(dest).Length == payload.Length, "file written with the right length");
            byte[] written = File.ReadAllBytes(dest);
            bool same = written.Length == payload.Length;
            for (int i = 0; same && i < written.Length; i++) same = written[i] == payload[i];
            Is(true, same, "file content is identical");
            Is(true, seen.Count > 2 && seen[seen.Count - 1] == payload.Length, "progress runs to the full length");
            bool rising = true;
            for (int i = 1; i < seen.Count; i++) rising = rising && seen[i] > seen[i - 1];
            Is(true, rising, "progress only moves forward");
            File.Delete(dest);

            Raises<UpdateException>(delegate { t.GetToFile(url, allowFile, dest, payload.Length - 1, 1000000, null, none); }, "announced length differs from the signed size");
            Is(false, File.Exists(dest), "nothing left after a length mismatch");
            s.Body("/dl/file", payload, true);
            Raises<UpdateException>(delegate { t.GetToFile(url, allowFile, dest, payload.Length - 1, 1000000, null, none); }, "stream longer than the signed size");
            Is(false, File.Exists(dest), "nothing left after an oversized stream");
            s.Body("/dl/file", payload, true);
            Raises<UpdateException>(delegate { t.GetToFile(url, allowFile, dest, payload.Length + 1, 1000000, null, none); }, "stream shorter than the signed size");
            Is(false, File.Exists(dest), "nothing left after a short stream");
            s.Short("/dl/file", payload.Length + 5000, payload);
            Raises<UpdateException>(delegate { t.GetToFile(url, allowFile, dest, payload.Length + 5000, 1000000, null, none); }, "connection dropped part-way");
            Is(false, File.Exists(dest), "nothing left after a dropped connection");
            s.Endless("/dl/file", 40L * 1024 * 1024);
            Raises<UpdateException>(delegate { t.GetToFile(url, allowFile, dest, payload.Length, 1000000, null, none); }, "an endless stream into a file");
            Is(false, File.Exists(dest), "nothing left after an endless stream");
            Is(true, Settled(s) < 8L * 1024 * 1024, "the server was cut off long before 40 MB (to disk)");

            int requests = s.Requests;
            Raises<UpdateException>(delegate { t.GetToFile(url, allowFile, dest, 0, 1000000, null, none); }, "zero expected length");
            Raises<UpdateException>(delegate { t.GetToFile(url, allowFile, dest, 2000000, 1000000, null, none); }, "expected length over the ceiling");
            Is(true, s.Requests == requests, "bad sizes are refused before any request");

            File.WriteAllText(dest, "keep me");
            s.Body("/dl/file", payload, false);
            Raises<IOException>(delegate { t.GetToFile(url, allowFile, dest, payload.Length, 1000000, null, none); }, "refuses to overwrite an existing file");
            Same("keep me", File.ReadAllText(dest), "an existing file is never deleted by a failed download");
        }
    }

    // ---- check, download, install ------------------------------------------------

    static byte[] fakeInstaller;

    // A real EXE that just records the arguments it was started with, so a test can see exactly
    // what the updater ran. Built once with the compiler that ships inside Windows.
    static byte[] FakeInstaller(string work)
    {
        if (fakeInstaller != null) return fakeInstaller;
        string path = Path.Combine(work, "fake-installer.exe");
        using (CSharpCodeProvider provider = new CSharpCodeProvider())
        {
            CompilerParameters options = new CompilerParameters();
            options.GenerateExecutable = true;
            options.OutputAssembly = path;
            options.CompilerOptions = "/nologo";
            CompilerResults result = provider.CompileAssemblyFromSource(options,
                "using System; using System.IO; static class P { static void Main(string[] a) { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, \"ran.txt\"), string.Join(\"|\", a)); } }");
            if (result.Errors.HasErrors) throw new Exception("Could not build the stand-in installer: " + result.Errors[0].ErrorText);
        }
        fakeInstaller = File.ReadAllBytes(path);
        return fakeInstaller;
    }

    static string WaitForMarker(string marker)
    {
        for (int i = 0; i < 200; i++)
        {
            Thread.Sleep(100);
            if (!File.Exists(marker)) continue;
            try { return File.ReadAllText(marker); }
            catch (IOException) { }
        }
        return null;
    }

    static void ClearMarker(string marker)
    {
        for (int i = 0; i < 50 && File.Exists(marker); i++)
        {
            try { File.Delete(marker); }
            catch (IOException) { Thread.Sleep(100); }
        }
    }

    static void EndToEnd(string work)
    {
        byte[] installer = FakeInstaller(work);
        CancellationToken none = CancellationToken.None;
        string deadBase;

        using (TestServer s = new TestServer())
        {
            deadBase = s.Base;
            UpdateEndpoints e = Local(s.Base);
            string installerUrl = s.Base + "/dl/HexShift-2.1.1-Setup.exe";
            byte[] feed = FeedOf(Item("2.1.1", installerUrl, Sign(installer), installer.Length.ToString(), "windows", "", "Fixes things."));
            s.Body("/updates/appcast.json", feed, false);
            s.Body("/updates/appcast.json.signature", Encoding.ASCII.GetBytes(Sign(feed) + "\n"), false);
            s.Redirect("/dl/HexShift-2.1.1-Setup.exe", "/cdn/installer", 302);
            s.Body("/cdn/installer", installer, false);

            string data = Path.Combine(work, "data-e2e");
            string staging = UpdatePolicy.StagingFolder(data);
            string marker = Path.Combine(staging, "ran.txt");
            UpdateService svc = new UpdateService(data, pub, "2.1.0", e, LocalTransport(e));

            Is(true, svc.Enabled, "service with a key is enabled");
            Is(true, svc.IsCheckDue(), "a fresh install is due for a check");
            CheckOutcome found = svc.Check(none);
            Is(true, found.Kind == CheckKind.Available && found.Offer != null, "check finds the newer version");
            Same("2.1.1", found.Offer == null ? null : found.Offer.Version, "offered version");
            Same("Fixes things.", found.Offer == null ? null : found.Offer.Notes, "offered notes");
            Is(false, svc.IsCheckDue(), "no second check is due straight after");
            Is(false, new UpdateService(data, pub, "2.1.0", e, LocalTransport(e)).IsCheckDue(), "the last-check time survives a restart");
            svc.AutoCheck = false;
            Is(false, new UpdateService(data, pub, "2.1.0", e, LocalTransport(e)).AutoCheck, "turning automatic checks off survives a restart");
            Is(false, new UpdateService(data, pub, "2.1.0", e, LocalTransport(e)).IsCheckDue(), "no check is due when automatic checks are off");
            svc.AutoCheck = true;
            Is(true, new UpdateService(data, pub, "2.1.1", e, LocalTransport(e)).Check(none).Kind == CheckKind.UpToDate, "the same version sees no update");

            long last = 0;
            string staged = svc.Download(found.Offer, delegate(long done, long total) { last = done; }, none);
            Same(Path.Combine(staging, "HexShift-2.1.1-Setup.exe"), staged, "staged installer path");
            Is(true, File.Exists(staged) && File.ReadAllBytes(staged).Length == installer.Length, "staged installer has the right length");
            Is(true, last == installer.Length, "download progress reached the end");
            Is(true, Directory.GetFiles(staging, "*.part").Length == 0, "no half-finished file left in staging");

            // installed copy: fixed silent switches
            svc.Install(found.Offer, staged, true);
            Same(UpdatePolicy.InstallerArguments.Replace(' ', '|'), WaitForMarker(marker), "installed copy runs the installer with the fixed switches");
            ClearMarker(marker);

            // portable copy: plain wizard, no switches
            staged = svc.Download(found.Offer, null, none);
            svc.Install(found.Offer, staged, false);
            Same("", WaitForMarker(marker), "portable copy runs the installer with no switches");
            ClearMarker(marker);

            // changed after staging: not run
            staged = svc.Download(found.Offer, null, none);
            byte[] bytes = File.ReadAllBytes(staged);
            bytes[bytes.Length / 2] ^= 1;
            File.WriteAllBytes(staged, bytes);
            Raises<UpdateException>(delegate { svc.Install(found.Offer, staged, true); }, "installer changed after staging");
            Thread.Sleep(1000);
            Is(false, File.Exists(marker), "a changed installer is never started");

            // wrong place, wrong name
            Raises<UpdateException>(delegate { svc.Install(found.Offer, Path.Combine(work, "fake-installer.exe"), true); }, "installer outside the staging folder");
            string copy = Path.Combine(staging, "evil.exe");
            File.WriteAllBytes(copy, installer);
            Raises<UpdateException>(delegate { svc.Install(found.Offer, copy, true); }, "wrongly named file in the staging folder");
            Raises<UpdateException>(delegate { svc.Install(found.Offer, null, true); }, "no installer path");
            File.Delete(copy);

            // downloads that must be refused and leave nothing behind
            byte[] evil = (byte[])installer.Clone();
            evil[evil.Length / 2] ^= 1;
            s.Body("/cdn/installer", evil, false);
            Raises<UpdateException>(delegate { svc.Download(found.Offer, null, none); }, "installer whose bytes do not match the signature");
            Is(true, Directory.GetFiles(staging, "HexShift-*").Length == 0, "nothing left in staging after a signature failure");

            byte[] longer = new byte[installer.Length + 10];
            Buffer.BlockCopy(installer, 0, longer, 0, installer.Length);
            s.Body("/cdn/installer", longer, false);
            Raises<UpdateException>(delegate { svc.Download(found.Offer, null, none); }, "installer longer than the signed size");
            Is(true, Directory.GetFiles(staging, "HexShift-*").Length == 0, "nothing left in staging after a size failure");

            s.Redirect("/dl/HexShift-2.1.1-Setup.exe", "/evil/installer", 302);
            s.Body("/evil/installer", installer, false);
            Raises<UpdateException>(delegate { svc.Download(found.Offer, null, none); }, "installer redirected somewhere not allowed");
            Is(true, s.Hits("/evil/installer") == 0, "the refused installer address is never contacted");

            // feeds that must be refused
            UpdateService wrongKey = new UpdateService(Path.Combine(work, "data-wrongkey"), otherPub, "2.1.0", e, LocalTransport(e));
            CheckOutcome refused = wrongKey.Check(none);
            Is(true, refused.Kind == CheckKind.Failed && !string.IsNullOrEmpty(refused.Message), "feed not signed by the app's key");
            Is(true, wrongKey.IsCheckDue(), "a failed check does not count as having checked");

            s.Body("/updates/appcast.json.signature", Encoding.ASCII.GetBytes(Sign(feed).Substring(4) + "AAAA"), false);
            Is(true, svc.Check(none).Kind == CheckKind.Failed, "a damaged signature file");
            s.Status("/updates/appcast.json.signature", 404);
            Is(true, svc.Check(none).Kind == CheckKind.Failed, "a missing signature file");
            s.Body("/updates/appcast.json.signature", new byte[UpdatePolicy.MaxSignatureBytes + 1], false);
            Is(true, svc.Check(none).Kind == CheckKind.Failed, "an oversized signature file");

            UpdateService off = new UpdateService(Path.Combine(work, "data-off"), null, "2.1.0", e, LocalTransport(e));
            Is(false, off.Enabled, "service without a key is disabled");
            Is(false, off.IsCheckDue(), "a disabled service never wants a check");
            Is(true, off.Check(none).Kind == CheckKind.Disabled, "a disabled service reports that, without contacting anyone");
            Raises<UpdateException>(delegate { off.Download(found.Offer, null, none); }, "a disabled service downloads nothing");
            Raises<UpdateException>(delegate { off.Install(found.Offer, staged, true); }, "a disabled service installs nothing");
        }

        // the server is gone: a failed check is an answer, not a crash
        UpdateEndpoints dead = Local(deadBase);
        UpdateService unreachable = new UpdateService(Path.Combine(work, "data-dead"), pub, "2.1.0", dead, LocalTransport(dead));
        CheckOutcome nothing = unreachable.Check(none);
        Is(true, nothing.Kind == CheckKind.Failed && !string.IsNullOrEmpty(nothing.Message), "an unreachable server is reported as a failed check");
    }
}
