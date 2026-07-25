"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";

export async function markReportCompleted(id: string) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("ecos_reports")
    .update({ status: "completed" })
    .eq("id", id);
  if (error) {
    console.error("markReportCompleted error:", error);
    return { error: "No se pudo actualizar el reporte" };
  }
  revalidatePath("/admin/reports");
  return { ok: true };
}

export async function markFeedbackCompleted(id: string) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("ecos_feedback")
    .update({ status: "completed" })
    .eq("id", id);
  if (error) {
    console.error("markFeedbackCompleted error:", error);
    return { error: "No se pudo actualizar el feedback" };
  }
  revalidatePath("/admin/reports");
  return { ok: true };
}

export async function deleteReport(id: string) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = createServiceClient();
  const { error } = await supabase.from("ecos_reports").delete().eq("id", id);
  if (error) {
    console.error("deleteReport error:", error);
    return { error: "No se pudo eliminar el reporte" };
  }
  revalidatePath("/admin/reports");
  return { ok: true };
}

export async function deleteFeedback(id: string) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = createServiceClient();
  const { error } = await supabase.from("ecos_feedback").delete().eq("id", id);
  if (error) {
    console.error("deleteFeedback error:", error);
    return { error: "No se pudo eliminar el feedback" };
  }
  revalidatePath("/admin/reports");
  return { ok: true };
}
