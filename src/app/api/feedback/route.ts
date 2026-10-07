import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/api/body-limit";
import { z } from "zod";

const FeedbackSchema = z.object({
  type: z.enum(["bug", "error", "suggestion"]),
  message: z.string().min(1).max(2000),
  email: z.string().email().max(320).optional().or(z.literal("")),
});

/**
 * `message` admite 2.000 caracteres, que en UTF-8 pueden ser hasta ~8 KB; con el email y el
 * resto del JSON, 16 KB deja margen sin abrir la puerta a cuerpos grandes.
 */
const FEEDBACK_BODY_LIMIT = 16 * 1024;

/**
 * Feedback desde la home. Es anónimo a propósito (también lo pueden mandar los invitados); si
 * hay sesión, se guarda el `user_id`. El abuso de frecuencia lo corta la regla de rate limit del
 * firewall de Vercel, y el tamaño, `readJsonBody`.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request, FEEDBACK_BODY_LIMIT);
    if (!body.ok) return body.response;
    const parsed = FeedbackSchema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { type, message, email } = parsed.data;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const serviceSupabase = createServiceClient();
    const { error: insertError } = await serviceSupabase.from("ecos_feedback").insert({
      type,
      message: message.trim(),
      email: email?.trim() || null,
      user_id: user?.id ?? null,
    });

    if (insertError) {
      console.error("feedback insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to save feedback" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("feedback error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
