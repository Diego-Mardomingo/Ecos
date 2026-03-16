import { AuthProvider } from "@/components/providers/AuthProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ScrollRestoration } from "@/components/scroll-restoration/ScrollRestoration";
import { AppLayoutClient } from "./AppLayoutClient";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <ScrollRestoration />
        <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col overflow-hidden bg-background">
          <AppLayoutClient>{children}</AppLayoutClient>
        </div>
      </AuthProvider>
    </QueryProvider>
  );
}
