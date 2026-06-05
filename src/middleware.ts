import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const isLoggedIn = !!req.auth?.user;
  const { pathname } = req.nextUrl;

  // Always allow: login page and all Auth.js API routes
  if (pathname === '/login' || pathname.startsWith('/api/auth')) {
    // Redirect already-authenticated users away from the login page
    if (isLoggedIn && pathname === '/login') {
      return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin));
    }
    return NextResponse.next();
  }

  if (!isLoggedIn) {
    // API routes: return 401 JSON so fetch callers handle it gracefully
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // All other pages: redirect to login
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Run on everything except Next.js internals, static assets, and the
  // cron snapshot endpoint — that route authenticates itself via CRON_SECRET,
  // so middleware must not block it (the Vercel cron carries no session cookie).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/inventory/snapshot).*)'],
};
