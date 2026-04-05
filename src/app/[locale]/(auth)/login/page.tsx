import { LoginClient } from "@/components/auth/LoginClient";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getSafeRedirectTarget } from "@/lib/auth/safeRedirectPath";

type Props = {
  searchParams: Promise<{ redirect?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const params = await searchParams;
  const safeRedirect = getSafeRedirectTarget(params.redirect);

  if (user) {
    redirect(safeRedirect ?? "/");
  }

  return <LoginClient />;
}
