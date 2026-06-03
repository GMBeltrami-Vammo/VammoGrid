import { createClient } from '@supabase/supabase-js';

// Anon key — safe to expose client-side. RLS controls read access.
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
