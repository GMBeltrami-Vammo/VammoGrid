import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { isHead } from '@/constants/roles';

const ALLOWED_DOMAIN = 'vammo.com';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  pages: {
    signIn: '/login',
    error: '/login',
  },

  callbacks: {
    // Only allow @vammo.com Google accounts
    signIn({ user }) {
      return user.email?.endsWith(`@${ALLOWED_DOMAIN}`) ?? false;
    },

    // Called by middleware to decide if a request is authorized
    authorized({ auth }) {
      return !!auth?.user;
    },

    // Expose Head status to the client (read-only convenience). The real
    // enforcement lives server-side in requireHead() — never trust this alone.
    session({ session }) {
      if (session.user) {
        session.user.isHead = isHead(session.user.email);
      }
      return session;
    },
  },
});
