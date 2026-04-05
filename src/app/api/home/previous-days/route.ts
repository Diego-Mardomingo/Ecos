import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPreviousDays } from "@/lib/queries/games";
import { getMadridDate } from "@/lib/date-utils";

function monthBounds(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const start = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const nextDate = new Date(Date.UTC(y, m, 1));
  const nextMonth = `${nextDate.getUTCFullYear()}-${String(
    nextDate.getUTCMonth() + 1
  ).padStart(2, "0")}-01`;
  return { start, nextMonth };
}

function getPreviousMonthKey(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const prevDate = new Date(Date.UTC(y, m - 2, 1));
  return `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedMonth = searchParams.get("month");
    const defaultMonth = getMadridDate().slice(0, 7);
    const month = requestedMonth ?? defaultMonth;
    const bounds = monthBounds(month);
    if (!bounds) {
      return NextResponse.json({ error: "Invalid month format" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const previousDays = await getPreviousDays(user?.id ?? null, undefined, undefined, {
      fromDate: bounds.start,
      toDate: bounds.nextMonth,
    });

    const { data: hasOlderRows } = await supabase
      .from("ecos_games")
      .select("id")
      .lt("date", bounds.start)
      .limit(1);

    const hasMoreOlder = !!(hasOlderRows && hasOlderRows.length > 0);
    const nextMonth = hasMoreOlder ? getPreviousMonthKey(month) : null;

    return NextResponse.json({
      previousDays,
      userId: user?.id ?? null,
      month,
      nextMonth,
      hasMoreOlder,
    });
  } catch (err) {
    console.error("api/home/previous-days error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
