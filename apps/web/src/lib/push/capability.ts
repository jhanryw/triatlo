import type { PublicConfig } from "@/lib/env";

export type PushPermission = "default" | "granted" | "denied";

/** Facts about the current device/browser. Collected in the browser; pure input for resolvePushState. */
export interface PushEnvironment {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIOS: boolean;
  /** Running as an installed Home Screen / desktop app. */
  isStandalone: boolean;
  permission: PushPermission;
  /** A push subscription already exists in this browser. */
  subscribed: boolean;
}

export type PushUiState =
  | "ios_needs_install"
  | "unsupported"
  | "backend_unavailable"
  | "denied"
  | "subscribed"
  | "ready";

/**
 * Decides what the Notifications card shows. The permission prompt is only reachable from "ready",
 * i.e. after the user taps the button; nothing here ever requests permission by itself.
 *
 * On iPhone, Web Push only exists for web apps installed to the Home Screen (iOS/iPadOS 16.4+),
 * so a non-installed iOS browser gets installation instructions before anything else.
 */
export function resolvePushState(env: PushEnvironment, config: PublicConfig): PushUiState {
  if (env.isIOS && !env.isStandalone) return "ios_needs_install";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  if (!config.pushEnabled || config.vapidPublicKey === null) return "backend_unavailable";
  if (env.permission === "denied") return "denied";
  if (env.subscribed) return "subscribed";
  return "ready";
}

export const PUSH_STATE_MESSAGES: Record<PushUiState, { title: string; body: string }> = {
  ios_needs_install: {
    title: "Instale o app para receber notificações",
    body: "No iPhone (iOS 16.4 ou superior), as notificações só funcionam com o app instalado: toque em Compartilhar, depois em “Adicionar à Tela de Início”, abra o app pelo ícone e volte aqui.",
  },
  unsupported: {
    title: "Notificações não disponíveis neste navegador",
    body: "Este navegador ou dispositivo não oferece notificações push para este app.",
  },
  backend_unavailable: {
    title: "Notificações ainda não configuradas",
    body: "O servidor de envio ainda não está configurado (Entrega 4). Nenhuma permissão será solicitada até lá.",
  },
  denied: {
    title: "Permissão bloqueada",
    body: "As notificações estão bloqueadas nas configurações do dispositivo. Reative-as lá para poder ativar aqui.",
  },
  subscribed: {
    title: "Notificações ativadas",
    body: "Você receberá avisos deste dispositivo. É possível desativar a qualquer momento.",
  },
  ready: {
    title: "Ativar notificações",
    body: "Ao tocar em “Ativar notificações”, o sistema pedirá sua permissão. Você controla quais avisos recebe e pode desativar quando quiser.",
  },
};

/** Browser-only. Call from an effect or event handler, never during server rendering. */
export async function detectPushEnvironment(): Promise<PushEnvironment> {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const nav = navigator as Navigator & { standalone?: boolean };
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;

  const hasServiceWorker = "serviceWorker" in navigator;
  const hasPushManager = "PushManager" in window;
  const hasNotification = "Notification" in window;

  let subscribed = false;
  if (hasServiceWorker && hasPushManager) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      subscribed = (await registration?.pushManager.getSubscription()) != null;
    } catch {
      subscribed = false;
    }
  }

  return {
    hasServiceWorker,
    hasPushManager,
    hasNotification,
    isIOS,
    isStandalone,
    permission: hasNotification ? Notification.permission : "default",
    subscribed,
  };
}
