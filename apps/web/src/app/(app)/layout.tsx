import { BottomNav, SideNav } from "@/components/Navigation";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:flex">
      <SideNav />
      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))] md:px-8 md:pb-12 md:pt-8">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
