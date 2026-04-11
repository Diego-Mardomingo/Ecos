import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getMadridDate } from "@/lib/date-utils";

export async function GET() {
  try {
    const effectiveDate = getMadridDate();
    const currentMonthKey = effectiveDate.slice(0, 7);
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("ecos_games")
      .select("date")
      .lt("date", effectiveDate)
      .order("date", { ascending: false });

    if (error) {
      throw error;
    }

    const monthSet = new Set<string>([currentMonthKey]);
    for (const row of data ?? []) {
      if (!row.date) continue;
      monthSet.add(String(row.date).slice(0, 7));
    }

    const monthKeys = [...monthSet].sort((a, b) => b.localeCompare(a));
    return NextResponse.json({ monthKeys });
  } catch (err) {
    console.error("api/home/months error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
