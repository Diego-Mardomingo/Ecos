import { redirect } from "next/navigation";
import { localizedPath } from "@/lib/i18n/localizedPath";

/** Redirige a la página de login del locale con ?redirect= destino tras autenticación. */
export function redirectToLoginWithReturn(locale: string, returnToPath: string): never {
  const login = localizedPath(locale, "/login");
  redirect(`${login}?redirect=${encodeURIComponent(returnToPath)}`);
}
