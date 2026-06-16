import type { DefaultSession } from 'next-auth';

// Augment the session so `session.user.isHead` is typed everywhere.
declare module 'next-auth' {
  interface Session {
    user: {
      isHead: boolean;
    } & DefaultSession['user'];
  }
}
