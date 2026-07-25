import { AuthProvider } from "@/components/providers/AuthProvider";
import { BottomNav } from "@/components/bottom-nav/BottomNav";
import { BackButton } from "@/components/admin/BackButton";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { requireAdminPage } from "@/lib/auth/requireAdmin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defensa en profundidad: `src/proxy.ts` ya filtra /admin, pero el middleware no es la
  // frontera de autorización. Cada página vuelve a comprobarlo por su cuenta porque en las
  // navegaciones de cliente Next puede no re-ejecutar este layout.
  await requireAdminPage();

  return (
    <QueryProvider>
      <AuthProvider>
        <div className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background">
          <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-background px-4 py-3">
            <BackButton />
            <h1 className="text-lg font-bold">Panel Admin</h1>
          </header>
          <main className="flex-1 overflow-y-auto p-4 pb-24">{children}</main>
          <BottomNav />
        </div>
      </AuthProvider>
    </QueryProvider>
  );
}
