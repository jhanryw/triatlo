export type NavIcon = "today" | "workouts" | "nutrition" | "progress" | "assistant" | "settings";

export interface NavItem {
  /** Technical route (English). */
  href: string;
  /** User-facing label (pt-BR). */
  label: string;
  /** Compact label for the mobile tab bar. */
  shortLabel: string;
  icon: NavIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Hoje", shortLabel: "Hoje", icon: "today" },
  { href: "/workouts", label: "Treinos", shortLabel: "Treinos", icon: "workouts" },
  { href: "/nutrition", label: "Alimentação", shortLabel: "Comida", icon: "nutrition" },
  { href: "/progress", label: "Evolução", shortLabel: "Evolução", icon: "progress" },
  { href: "/assistant", label: "Assistente", shortLabel: "Assistente", icon: "assistant" },
  { href: "/settings", label: "Configurações", shortLabel: "Ajustes", icon: "settings" },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
