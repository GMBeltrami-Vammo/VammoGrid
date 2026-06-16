// Head role — the only users allowed to mutate planning data (purchase orders,
// compatibility matrix, fleet info, per-SKU recovery params).
//
// There is no Supabase Auth in this app: identity comes from NextAuth/Google at
// the app layer. So this list is the single source of truth, enforced server-side
// in every Server Action and surfaced to the client (read-only) via the session.
export const HEAD_EMAILS = [
  'gabriel.beltrami@vammo.com',
  'pablo@vammo.com',
  'joao.beraldo@vammo.com',
] as const;

export function isHead(email: string | null | undefined): boolean {
  if (!email) return false;
  return (HEAD_EMAILS as readonly string[]).includes(email.toLowerCase().trim());
}
