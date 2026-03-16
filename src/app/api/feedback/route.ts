import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

const FeedbackSchema = z.object({
  type: z.enum(["bug", "error", "suggestion"]),
  message: z.string().min(1).max(2000),
  email: z.string().email().max(320).optional().or(z.literal("")),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = FeedbackSchema.safeParse(body);
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
