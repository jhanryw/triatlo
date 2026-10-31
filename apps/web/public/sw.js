/* Triatlo Inteligente — service worker.
 *
 * Scope on purpose: push display + notification click only. No fetch handler and no caching in Delivery 1.
 * Every push MUST end in showNotification (iOS/Safari require user-visible notifications), so malformed
 * payloads fall back to a generic message instead of being dropped.
 * The payload shape mirrors PushPayloadSchema in packages/shared (kept dependency-free here).
 */

const DEFAULT_TITLE = "Triatlo Inteligente";
const DEFAULT_BODY = "Você tem uma atualização no app.";

function safeUrl(value) {
  // Same-origin paths only; protocol-relative ("//host") is rejected.
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/";
}

function text(value, max, fallback) {
  return typeof value === "string" && value.trim() !== "" ? value.slice(0, max) : fallback;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_error) {
    data = {};
  }
  if (data === null || typeof data !== "object") data = {};

  const options = {
    body: text(data.body, 200, DEFAULT_BODY),
    icon: "/icons/icon-192.png",
    data: { url: safeUrl(data.url) },
  };
  if (typeof data.tag === "string" && data.tag !== "") options.tag = data.tag;

  event.waitUntil(self.registration.showNotification(text(data.title, 80, DEFAULT_TITLE), options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safeUrl(event.notification.data && event.notification.data.url), self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      for (const client of windowClients) {
        if ("navigate" in client && "focus" in client) {
          return client.navigate(target).then((navigated) => (navigated || client).focus());
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
