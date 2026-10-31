import { describe, expect, it } from "vitest";
import type { PublicConfig } from "@/lib/env";
import { PUSH_STATE_MESSAGES, resolvePushState, type PushEnvironment } from "./capability";
import { urlBase64ToUint8Array } from "./client";

const supported: PushEnvironment = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  isIOS: false,
  isStandalone: false,
  permission: "default",
  subscribed: false,
};
const enabled: PublicConfig = { pushEnabled: true, vapidPublicKey: "BKey" };
const disabled: PublicConfig = { pushEnabled: false, vapidPublicKey: null };

describe("resolvePushState", () => {
  it("asks iPhone users to install the app first (Web Push needs the Home Screen app)", () => {
    const iosBrowser = { ...supported, isIOS: true, hasPushManager: false };
    expect(resolvePushState(iosBrowser, enabled)).toBe("ios_needs_install");
    expect(resolvePushState({ ...iosBrowser, isStandalone: true, hasPushManager: true }, enabled)).toBe("ready");
  });

  it("reports unsupported browsers", () => {
    expect(resolvePushState({ ...supported, hasPushManager: false }, enabled)).toBe("unsupported");
    expect(resolvePushState({ ...supported, hasNotification: false }, enabled)).toBe("unsupported");
  });

  it("never offers the permission prompt while the backend is not configured", () => {
    expect(resolvePushState(supported, disabled)).toBe("backend_unavailable");
    expect(resolvePushState(supported, { pushEnabled: true, vapidPublicKey: null })).toBe("backend_unavailable");
    expect(resolvePushState(supported, { pushEnabled: false, vapidPublicKey: "BKey" })).toBe("backend_unavailable");
  });

  it("reaches 'ready' (the only state with an enable button) only when everything is in place", () => {
    expect(resolvePushState(supported, enabled)).toBe("ready");
    expect(resolvePushState({ ...supported, permission: "denied" }, enabled)).toBe("denied");
    expect(resolvePushState({ ...supported, permission: "granted", subscribed: true }, enabled)).toBe("subscribed");
  });

  it("has a message for every state", () => {
    for (const state of ["ios_needs_install", "unsupported", "backend_unavailable", "denied", "subscribed", "ready"] as const) {
      expect(PUSH_STATE_MESSAGES[state].title).toBeTruthy();
      expect(PUSH_STATE_MESSAGES[state].body).toBeTruthy();
    }
    expect(PUSH_STATE_MESSAGES.ios_needs_install.body).toMatch(/Tela de Início/);
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with and without padding", () => {
    // "hello" -> aGVsbG8 (base64url, no padding)
    expect(Array.from(urlBase64ToUint8Array("aGVsbG8"))).toEqual([104, 101, 108, 108, 111]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});
