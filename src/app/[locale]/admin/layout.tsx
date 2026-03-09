import Link from "next/link";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-background px-4 py-3">
        <Link
          href="/"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-muted"
        >
          <span className="material-symbols-outlined text-xl">arrow_back</span>
        </Link>
        <h1 className="text-lg font-bold">Panel Admin</h1>
      </header>
      <main className="flex-1 overflow-y-auto p-4">{children}</main>
    </div>
  );
}
