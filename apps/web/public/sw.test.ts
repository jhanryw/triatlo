import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type Handler = (event: Record<string, unknown>) => void;

function loadServiceWorker() {
  const handlers: Record<string, Handler> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler;
    },
    skipWaiting: () => undefined,
    location: { origin: "https://app.example" },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve([]),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve(null);
      },
    },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
  };
  const code = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  vm.runInNewContext(code, { self, URL });

  const run = async (type: string, event: Record<string, unknown>) => {
    const pending: Promise<unknown>[] = [];
    handlers[type]?.({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  };
  return { run, shown, opened };
}

const pushEvent = (data: unknown) => ({ data: { json: () => data } });

describe("service worker", () => {
  it("shows the notification described by the payload", async () => {
    const sw = loadServiceWorker();
    await sw.run("push", pushEvent({ title: "Treino", body: "Hoje às 18h", url: "/workouts", tag: "w1" }));
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]?.title).toBe("Treino");
    expect(sw.shown[0]?.options).toMatchObject({ body: "Hoje às 18h", tag: "w1", data: { url: "/workouts" } });
  });

  it("always shows a notification, even for malformed or empty payloads (user-visible push)", async () => {
    const sw = loadServiceWorker();
    await sw.run("push", { data: { json: () => { throw new Error("bad json"); } } });
    await sw.run("push", { data: null });
    await sw.run("push", pushEvent(42));
    expect(sw.shown).toHaveLength(3);
    for (const item of sw.shown) expect(item.title).toBe("Triatlo Inteligente");
  });

  it("opens only same-origin paths on click", async () => {
    const sw = loadServiceWorker();
    const click = (url: unknown) => ({ notification: { close: () => undefined, data: { url } } });
    await sw.run("notificationclick", click("/settings"));
    await sw.run("notificationclick", click("//evil.example/x"));
    await sw.run("notificationclick", click("https://evil.example"));
    expect(sw.opened).toEqual(["https://app.example/settings", "https://app.example/", "https://app.example/"]);
  });

  it("does not request permissions or cache anything (no fetch handler)", () => {
    const code = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
    expect(code).not.toMatch(/requestPermission/);
    expect(code).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(code).not.toMatch(/caches\./);
  });
});
