import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
async function harness() {
  const handlers = {},
    storage = new Map([
      ["another-app", new Map([["important", new Response("keep")]])],
      ["hexshift-shell-old", new Map()],
      ["hexshift-v1", new Map()],
    ]);
  let fail = false;
  const deleted = [];
  const caches = {
    keys: async () => [...storage.keys()],
    delete: async (key) => {
      deleted.push(key);
      return storage.delete(key);
    },
    open: async (key) => {
      if (!storage.has(key)) storage.set(key, new Map());
      const data = storage.get(key);
      return {
        addAll: async (urls) => {
          for (const url of urls)
            data.set(
              url,
              new Response(url, {
                headers: {
                  "content-type": url.endsWith(".png")
                    ? "image/png"
                    : "text/html",
                },
              }),
            );
        },
        match: async (request) =>
          data.get(
            typeof request === "string" ? request : request.url || request.href,
          ),
        put: async (request, response) => data.set(request.url, response),
      };
    },
  };
  const self = {
    location: { href: "https://example.test/HexShift/sw.js" },
    clients: { claim: async () => {} },
    addEventListener: (type, fn) => (handlers[type] = fn),
  };
  vm.runInNewContext(await readFile("sw.js", "utf8"), {
    self,
    caches,
    URL,
    Response,
    fetch: async (request) => {
      if (fail) throw Error("offline");
      return new Response("network", {
        headers: {
          "content-type": request.url.endsWith(".png")
            ? "image/png"
            : "text/html",
        },
      });
    },
  });
  const lifecycle = async (type) => {
    let promise;
    handlers[type]({ waitUntil: (p) => (promise = p) });
    await promise;
  };
  const request = async (url, mode = "same-origin") => {
    let promise;
    handlers.fetch({
      request: { method: "GET", url, mode },
      respondWith: (p) => (promise = p),
    });
    return promise ? await promise : null;
  };
  return {
    handlers,
    storage,
    deleted,
    lifecycle,
    request,
    offline: () => (fail = true),
  };
}
test("service worker only removes its own old caches", async () => {
  const h = await harness();
  await h.lifecycle("install");
  await h.lifecycle("activate");
  assert.ok(h.storage.has("another-app"));
  assert.deepEqual(h.deleted.sort(), ["hexshift-shell-old", "hexshift-v1"]);
});
test("offline shell loads but unknown resources and other projects are untouched", async () => {
  const h = await harness();
  await h.lifecycle("install");
  h.offline();
  assert.equal(
    (await h.request("https://example.test/HexShift/index.html", "navigate"))
      .status,
    200,
  );
  assert.equal(
    await h.request("https://example.test/elsewhere/index.html", "navigate"),
    null,
  );
  assert.equal(
    await h.request("https://example.test/HexShift/missing.js"),
    null,
  );
  assert.equal(
    await h.request("https://example.test/HexShift/index.html?other=1"),
    null,
  );
});
test("an asset miss never receives HTML fallback", async () => {
  const h = await harness();
  await h.lifecycle("install");
  for (const data of h.storage.values())
    data.delete("https://example.test/HexShift/icons/icon-192.png");
  h.offline();
  const response = await h.request(
    "https://example.test/HexShift/icons/icon-192.png",
  );
  assert.equal(response.type, "error");
});
