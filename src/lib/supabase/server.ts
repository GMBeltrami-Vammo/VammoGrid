import { createClient } from '@supabase/supabase-js';

// Service-role client — server-side only. Bypasses RLS for writes.
export function createServerSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
