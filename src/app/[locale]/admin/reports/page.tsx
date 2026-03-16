import { createServiceClient } from "@/lib/supabase/server";
import { AdminReportsClient } from "./AdminReportsClient";

export default async function AdminReportsPage() {
  const supabase = await createServiceClient();

  const [
    { data: reports },
    { data: feedbackList },
  ] = await Promise.all([
    supabase
      .from("ecos_reports")
      .select(
        `
        id, reason, description, status, created_at,
        ecos_songs ( title, artist_name )
      `
      )
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("ecos_feedback")
      .select("id, type, message, email, user_id, status, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const reportItems = (reports ?? []).map((r) => ({
    ...r,
    ecos_songs: r.ecos_songs as { title: string; artist_name: string } | null,
  }));

  return (
    <AdminReportsClient
      reports={reportItems}
      feedbackList={feedbackList ?? []}
    />
  );
}
