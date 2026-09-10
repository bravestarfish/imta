import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveBookable } from "@/lib/event-types/service";
import { availableSlots } from "@/lib/bookings/service";

/** Slots for a booking page: ?id=<eventTypeId>&from=<ms>&to=<ms>&k=<linkKey> */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const from = Number(url.searchParams.get("from"));
  const to = Number(url.searchParams.get("to"));
  const k = url.searchParams.get("k");
  if (!id || !Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 45 * 86_400_000) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const et = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, id) });
  if (!et) return NextResponse.json({ error: "not found" }, { status: 404 });
  const user = await getCurrentUser();
  const owner = et.ownerDid ? await db.query.users.findFirst({ where: eq(schema.users.did, et.ownerDid) }) : null;
  const team = et.teamId ? await db.query.teams.findFirst({ where: eq(schema.teams.id, et.teamId) }) : null;
  const access = await resolveBookable(et.ownerKind === "user" ? { handle: owner?.handle } : { teamSlug: team?.slug }, et.slug, user, k);
  if (!access || access.access !== "ok") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { slots, openSessions } = await availableSlots(et, { start: from, end: to });
  return NextResponse.json({
    // Never expose which hosts are free in "anyone" mode: the booker only sees times.
    slots: slots.map((s) => ({ start: s.start, end: s.end })),
    sessions: openSessions.map((m) => ({ id: m.id, start: m.startAt.getTime(), end: m.endAt.getTime(), seatsLeft: m.seatsLeft })),
  });
}
