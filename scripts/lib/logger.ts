import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import { logSystemJob, type LogSystemJobParams } from "../../src/lib/system-logger";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }
  return createClient(url, key);
}

export async function logJob(params: LogSystemJobParams): Promise<void> {
  const supabase = getSupabase();
  await logSystemJob(supabase, params);
}
