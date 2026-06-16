import { auth } from '@/auth';
import { isHead } from '@/constants/roles';

// Server-side authorization gate for mutating planning data.
// Call at the top of every Head-gated Server Action. Returns the verified Head
// email (used to stamp updated_by), or throws if the caller is not a Head.
export async function requireHead(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !isHead(email)) {
    throw new Error('Acesso restrito: apenas Heads podem alterar estes dados.');
  }
  return email;
}
