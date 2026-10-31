import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Triatlo Inteligente", template: "%s · Triatlo Inteligente" },
  description: "Treino, alimentação e recuperação para o seu retorno ao triatlo.",
  applicationName: "Triatlo Inteligente",
  appleWebApp: { capable: true, title: "Triatlo", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // Private personal app: keep it out of search indexes.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
