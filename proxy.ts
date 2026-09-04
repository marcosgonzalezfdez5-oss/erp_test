import { clerkMiddleware } from "@clerk/nextjs/server";

// Only establishes the Clerk request context so `auth()`/`auth.protect()`
// work in Server Components/route handlers. Per-route protection is done
// as a resource-based check in each protected page — see app/dashboard/page.tsx
// (path-matching in a central proxy is now the deprecated pattern).
export default clerkMiddleware();

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
