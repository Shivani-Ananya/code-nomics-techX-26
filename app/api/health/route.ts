import { db } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [queue] = await db()`SELECT count(*) FILTER (WHERE status='queued')::int AS queued, count(*) FILTER (WHERE status='running')::int AS running FROM submission_jobs`;
    return Response.json({ status: "healthy", service: "code-auction-web", database: "connected", queue, timestamp: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return Response.json({ status: "unhealthy", service: "code-auction-web", database: "unavailable", timestamp: new Date().toISOString() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
