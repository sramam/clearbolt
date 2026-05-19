import {
  hasDevAuthBypass,
  isBetterAuthConfigured,
} from "@/lib/auth-config";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/sign-in" || pathname.startsWith("/sign-in/")) {
    return true;
  }
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
    return true;
  }
  return false;
}

async function hasSessionUser(request: NextRequest): Promise<boolean> {
  if (!isBetterAuthConfigured()) return false;
  const res = await fetch(
    new URL("/api/auth/get-session", request.nextUrl.origin),
    {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    },
  );
  if (!res.ok) return false;
  try {
    const body = (await res.json()) as { user?: { id?: string } | null };
    return Boolean(body?.user?.id);
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (hasDevAuthBypass()) {
    return NextResponse.next();
  }

  if (await hasSessionUser(request)) {
    return NextResponse.next();
  }

  const signIn = new URL("/sign-in", request.url);
  const nextPath = `${pathname}${request.nextUrl.search}`;
  if (nextPath && nextPath !== "/") {
    signIn.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: [
    /*
     * All routes except static assets and image optimizer output.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
