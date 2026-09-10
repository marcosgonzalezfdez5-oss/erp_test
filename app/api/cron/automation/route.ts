import { drainPendingRuns, enqueueScheduledRuns } from "@/lib/automation/runner";

/**
 * Drives the automation job queue. Called by Vercel Cron (see vercel.json) on
 * a fixed interval, authenticated with a shared secret. A legitimate route
 * handler per CLAUDE.md §13 — this isn't CRUD that could be a procedure.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const enqueued = await enqueueScheduledRuns();
  const drained = await drainPendingRuns();
  return Response.json({ enqueued, drained });
}
