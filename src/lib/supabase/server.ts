import { createClient } from '@supabase/supabase-js';

// Uses the anon key — INSERT is allowed via RLS policy on fleet.piece_stock_hub.
// The snapshot endpoint is protected by CRON_SECRET at the app layer.
export function createServerSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}
