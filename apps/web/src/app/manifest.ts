import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Triatlo Inteligente",
    short_name: "Triatlo",
    description: "Treino, alimentação e recuperação para o seu retorno ao triatlo.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    // iOS only offers Web Push to Home Screen apps whose manifest display is standalone or fullscreen.
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b1020",
    theme_color: "#0b1020",
    categories: ["health", "fitness", "sports"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
