"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js. Registration does NOT request any permission and has no visible effect:
 * the worker only handles push/notification events and does no caching in Delivery 1.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Unsupported or blocked context (e.g. insecure origin): the app works without it.
    });
  }, []);

  return null;
}
