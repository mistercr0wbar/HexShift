// Hex Shift - update downloads.
//
// Every update request goes through here. The first address must pass the rule the
// caller gives, each redirect is checked against that request's redirect rule and budget
// before it is followed, every byte is counted against a ceiling as it is read, and the
// whole request has a deadline. Nothing is trusted from the server's headers.
//
// C# 5 on purpose, like the rest of the host.

using System;
using System.IO;
using System.Net;
using System.Threading;

namespace HexShift
{
    // A problem the user can be told about in plain words.
    sealed class UpdateException : Exception
    {
        public UpdateException(string message) : base(message) { }
    }

    // What one request may do: where it may start, where redirects may lead and how many, and
    // how long the whole thing may take.
    sealed class UpdateRoute
    {
        internal Func<string, bool> First;
        internal Func<string, bool> Redirect;
        internal int MaxRedirects;
        internal TimeSpan Deadline;
    }

    sealed class UpdateTransport
    {
        readonly string userAgent;

        internal UpdateTransport(string userAgent)
        {
            this.userAgent = userAgent;
        }

        internal static UpdateTransport ForRelease()
        {
            return new UpdateTransport("HexShift/" + Program.Version);
        }

        // An open response plus what must be released with it.
        sealed class Fetch : IDisposable
        {
            internal HttpWebResponse Response;
            internal CancellationTokenRegistration Registration;

            public void Dispose()
            {
                Registration.Dispose();
                if (Response != null) Response.Close();
            }
        }

        // Follows only allowed redirects. The caller disposes what comes back.
        Fetch Open(string url, UpdateRoute route, CancellationToken token)
        {
            if (url == null || !route.First(url)) throw new UpdateException("HexShift will not contact that address.");
            string current = url;
            for (int hop = 0; ; hop++)
            {
                token.ThrowIfCancellationRequested();
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(current);
                request.Method = "GET";
                request.AllowAutoRedirect = false;
                request.AutomaticDecompression = DecompressionMethods.None;
                request.KeepAlive = false;
                request.UserAgent = userAgent;
                request.Timeout = 20000;
                request.ReadWriteTimeout = 30000;
                request.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);

                Fetch fetch = new Fetch();
                fetch.Registration = token.Register(delegate { request.Abort(); });
                try { fetch.Response = (HttpWebResponse)request.GetResponse(); }
                catch (WebException ex)
                {
                    fetch.Dispose();
                    if (token.IsCancellationRequested) throw new OperationCanceledException(token);
                    throw new UpdateException("The update server could not be reached (" + ex.Status + ").");
                }

                int status = (int)fetch.Response.StatusCode;
                if (status == 200) return fetch;
                if (status < 300 || status >= 400)
                {
                    fetch.Dispose();
                    throw new UpdateException("The update server answered with status " + status + ".");
                }

                string location = fetch.Response.Headers["Location"];
                fetch.Dispose();
                if (hop >= route.MaxRedirects) throw new UpdateException("The update server redirected too many times.");
                Uri next;
                if (string.IsNullOrEmpty(location) || !Uri.TryCreate(new Uri(current), location, out next))
                    throw new UpdateException("The update server sent an unusable redirect.");
                if (!route.Redirect(next.AbsoluteUri))
                    throw new UpdateException("The update server redirected to an address HexShift does not accept.");
                current = next.AbsoluteUri;
            }
        }

        // Runs one request under the route's overall deadline. Running out of time is a plain
        // UpdateException; a cancel from the caller stays a cancel.
        static T Within<T>(UpdateRoute route, CancellationToken token, Func<CancellationToken, T> work)
        {
            using (CancellationTokenSource limit = CancellationTokenSource.CreateLinkedTokenSource(token))
            {
                limit.CancelAfter(route.Deadline);
                try { return work(limit.Token); }
                catch (OperationCanceledException)
                {
                    if (token.IsCancellationRequested) throw;
                    throw new UpdateException("The update server took too long to answer.");
                }
            }
        }

        // The whole response in memory, never more than maxBytes.
        internal byte[] GetBytes(string url, UpdateRoute route, int maxBytes, CancellationToken token)
        {
            return Within<byte[]>(route, token, delegate(CancellationToken limited)
            {
                using (Fetch fetch = Open(url, route, limited))
                {
                    if (fetch.Response.ContentLength > maxBytes) throw new UpdateException("The response is larger than HexShift allows.");
                    using (Stream body = fetch.Response.GetResponseStream())
                    using (MemoryStream buffer = new MemoryStream())
                    {
                        byte[] chunk = new byte[16 * 1024];
                        int read;
                        while ((read = Read(body, chunk, limited)) > 0)
                        {
                            if (buffer.Length + read > maxBytes) throw new UpdateException("The response is larger than HexShift allows.");
                            buffer.Write(chunk, 0, read);
                        }
                        return buffer.ToArray();
                    }
                }
            });
        }

        // The response written to a new file that must come out exactly expectedLength bytes
        // long. The file is deleted again if anything goes wrong. progress(read, expected) is
        // called from this thread, at most once per percent.
        internal void GetToFile(string url, UpdateRoute route, string path, long expectedLength, long maxBytes, Action<long, long> progress, CancellationToken token)
        {
            if (expectedLength <= 0 || expectedLength > maxBytes) throw new UpdateException("The announced download size is not acceptable.");
            bool created = false;
            bool finished = false;
            try
            {
                Within<bool>(route, token, delegate(CancellationToken limited)
                {
                    using (Fetch fetch = Open(url, route, limited))
                    {
                        long declared = fetch.Response.ContentLength;
                        if (declared >= 0 && declared != expectedLength) throw new UpdateException("The download's size differs from the signed update information.");
                        using (Stream body = fetch.Response.GetResponseStream())
                        using (FileStream file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        {
                            created = true;
                            byte[] chunk = new byte[64 * 1024];
                            long total = 0;
                            int lastPercent = -1;
                            int read;
                            while ((read = Read(body, chunk, limited)) > 0)
                            {
                                total += read;
                                if (total > expectedLength) throw new UpdateException("The download is larger than the signed update information says.");
                                file.Write(chunk, 0, read);
                                int percent = (int)(total * 100 / expectedLength);
                                if (progress != null && percent != lastPercent) { lastPercent = percent; progress(total, expectedLength); }
                            }
                            file.Flush(true);
                            if (total != expectedLength) throw new UpdateException("The download ended early.");
                        }
                    }
                    return true;
                });
                finished = true;
            }
            finally
            {
                // Only a file this call created is ever deleted here.
                if (created && !finished) { try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
            }
        }

        // A stream read that reports cancellation and network failure the way callers expect.
        static int Read(Stream body, byte[] chunk, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            try { return body.Read(chunk, 0, chunk.Length); }
            catch (IOException ex)
            {
                if (token.IsCancellationRequested) throw new OperationCanceledException(token);
                throw new UpdateException("The connection to the update server was interrupted (" + ex.Message + ").");
            }
            catch (WebException ex)
            {
                if (token.IsCancellationRequested) throw new OperationCanceledException(token);
                throw new UpdateException("The connection to the update server was interrupted (" + ex.Status + ").");
            }
            catch (ObjectDisposedException)
            {
                if (token.IsCancellationRequested) throw new OperationCanceledException(token);
                throw new UpdateException("The connection to the update server was closed.");
            }
        }
    }
}
