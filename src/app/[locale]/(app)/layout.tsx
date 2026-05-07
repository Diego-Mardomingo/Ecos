import { AuthProvider } from "@/components/providers/AuthProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ScrollRestoration } from "@/components/scroll-restoration/ScrollRestoration";
import { AppLayoutClient } from "./AppLayoutClient";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <ScrollRestoration />
        <div className="relative flex min-h-dvh w-full overflow-hidden bg-background min-[670px]:overflow-visible">
          <AppLayoutClient>{children}</AppLayoutClient>
        </div>
      </AuthProvider>
    </QueryProvider>
  );
}
