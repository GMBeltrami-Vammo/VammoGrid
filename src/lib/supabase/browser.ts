import { createClient } from '@supabase/supabase-js';

// Anon key — safe to expose client-side. RLS controls read access.
//
// Fallbacks keep this from throwing at import time during a build that lacks the
// public env (e.g. local `next build` without .env). These NEXT_PUBLIC values are
// inlined at build time, so on Vercel the real URL/key are baked in; the client
// only ever issues requests after hydration in the browser.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

export const supabaseBrowser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
