"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";

export async function markReportCompleted(id: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("ecos_reports")
    .update({ status: "completed" })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/reports");
  return { ok: true };
}

export async function markFeedbackCompleted(id: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("ecos_feedback")
    .update({ status: "completed" })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/reports");
  return { ok: true };
}

export async function deleteReport(id: string) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("ecos_reports").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/reports");
  return { ok: true };
}

export async function deleteFeedback(id: string) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("ecos_feedback").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/reports");
  return { ok: true };
}
