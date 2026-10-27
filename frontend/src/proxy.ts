import { type NextRequest, NextResponse } from 'next/server';

/**
 * Cheap routing guard. `vx_session` is a non-secret flag cookie the API sets alongside the httpOnly tokens;
 * real authorization always happens in the API.
 */
const PUBLIC = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/invite'];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const signedIn = req.cookies.has('vx_session');
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!signedIn && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  // No "signed in, skip /login" redirect: the flag can outlive a revoked session and would loop.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|brand|sw.js|manifest.webmanifest|favicon.ico).*)'],
};
