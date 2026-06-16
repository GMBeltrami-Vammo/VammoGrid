import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// SERVER-ONLY Supabase client (service-role key).
//
// The service-role key bypasses RLS, so this MUST never reach the browser. It is
// only imported by Server Actions and Route Handlers, which Next.js bundles
// server-side. The runtime guard below is a second line of defence: if this ever
// gets pulled into a client bundle, it throws instead of leaking the key.
//
// Every caller is responsible for authorization BEFORE using this client:
//   • Head Server Actions  → verify the session email is a Head (see requireHead)
//   • n8n ingest route     → verify the bearer secret
// ─────────────────────────────────────────────────────────────────────────────
export function createServiceSupabase() {
  if (typeof window !== 'undefined') {
    throw new Error('createServiceSupabase must never run in the browser');
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
