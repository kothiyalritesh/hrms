// @ts-nocheck -- Jest executes this in Node; the app tsconfig is browser/native.
import fs from "fs";
import path from "path";

describe("production service worker", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "public", "sw.js"),
    "utf8",
  );

  it("limits the app-shell fallback to navigation requests", () => {
    expect(source).toContain('event.request.mode === "navigate"');
    expect(source).toContain("if (isNavigation)");
    expect(source).toContain("if (isNavigation && !response.ok)");
  });

  it("never serves HTML as a static asset response", () => {
    expect(source).toContain('contentType.includes("text/html")');
    expect(source).toContain("if (cachedAsset) return cachedAsset");
    expect(source).toContain("Application asset unavailable");
    expect(source).toContain("Offline asset unavailable");
    expect(source).toContain('event.request.destination === "image"');
    expect(source).toContain('event.request.destination === "font"');
    expect(source).not.toContain(
      'cached || caches.match("./")',
    );
  });

  it("retains the immediately previous cache and activates through an explicit message", () => {
    expect(source).toContain("caches.delete(key)");
    expect(source).toContain("key.startsWith(CACHE_PREFIX)");
    expect(source).toContain("priorReleaseCaches");
    expect(source).toContain("retainedCaches");
    expect(source).toContain("SKIP_WAITING");
    expect(source).toContain("self.clients.claim()");
  });

  it("only caches executable or shell assets and bounds cache growth", () => {
    expect(source).toContain("isStaticAsset || isShellAsset");
    expect(source).toContain("const RELEASE_SCRIPTS = __BOP_PRECACHE_ASSETS__");
    expect(source).toContain("cache.addAll(CRITICAL_SHELL)");
    expect(source).toContain("Promise.allSettled");
    expect(source).toContain("RELEASE_SCRIPTS.map");
    expect(source).toContain("MAX_CACHE_ENTRIES");
    expect(source).toContain("trimCache(cache)");
  });
});
