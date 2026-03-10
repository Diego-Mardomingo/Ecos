import { BottomNav } from "@/components/bottom-nav/BottomNav";
import { BackButton } from "@/components/admin/BackButton";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-background px-4 py-3">
        <BackButton />
        <h1 className="text-lg font-bold">Panel Admin</h1>
      </header>
      <main className="flex-1 overflow-y-auto p-4 pb-24">{children}</main>
      <BottomNav />
    </div>
  );
}
