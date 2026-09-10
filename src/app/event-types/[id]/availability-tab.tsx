import Link from "next/link";
import { DateTime } from "luxon";
import type { EventType, EventTypeHost, User } from "@/db/schema";
import { listSchedules, hostPaintZone, eventPaintRows, eventPaintSummary } from "@/lib/availability/service";
import { busyFor } from "@/lib/calendar/service";
import { effectiveCells, weeklyCells, windowsToCells, STEP } from "@/lib/availability/painter";
import { displayName } from "@/lib/users/service";
import { setEventAvailabilityModeAction, clearEventPaintAction } from "@/app/actions/availability";
import { Badge } from "@/components/ui";
import { WeekPainter, type PainterDay } from "@/app/availability/[id]/calendar/week-painter";

/**
 * "Availability" tab of an event type: the signed-in host paints when they
 * are available for this event. Other hosts do the same from their account.
 */
export async function AvailabilityTab({ et, user, hosts, hostUsers, week }: { et: EventType; user: User; hosts: EventTypeHost[]; hostUsers: Map<string, User>; week?: string }) {
  const me = hosts.find((h) => h.userDid === user.did);
  const summary = await eventPaintSummary(et.id);
  const zone = await hostPaintZone(user.did);
  const today = DateTime.now().setZone(zone).startOf("day");
  const weekStart = (week ? DateTime.fromISO(week, { zone }) : today).startOf("week");
  const window = { start: weekStart.toMillis(), end: weekStart.plus({ days: 7 }).toMillis() };

  const days: PainterDay[] = [];
  if (me) {
    const schedules = await listSchedules(user.did);
    const schedule = (me.scheduleId ? schedules.find((s) => s.id === me.scheduleId) : undefined) ?? schedules.find((s) => s.isDefault) ?? schedules[0];
    const rules = schedule?.rules ?? [];
    const overrides = schedule?.overrides ?? [];
    const painted = await eventPaintRows(et.id, user.did, weekStart.toISODate()!, weekStart.plus({ days: 6 }).toISODate()!);
    const busy = (await busyFor([user.did], window)).get(user.did) ?? [];
    for (let i = 0; i < 7; i++) {
      const day = weekStart.plus({ days: i });
      const date = day.toISODate()!;
      const weekday = day.weekday % 7;
      const mine = painted.filter((p) => p.date === date);
      const scheduleCells = effectiveCells(rules, overrides, date, weekday);
      const cells = mine.length
        ? mine.some((p) => p.unavailable)
          ? []
          : windowsToCells(mine.filter((p) => p.startMinutes != null && p.endMinutes != null).map((p) => ({ startMinutes: p.startMinutes!, endMinutes: p.endMinutes! })))
        : me.availabilityMode === "painted"
          ? []
          : scheduleCells;
      const busyCells = new Set<number>();
      for (const b of busy) {
        for (let c = 0; c < 48; c++) {
          const s = day.plus({ minutes: c * STEP }).toMillis();
          const e = day.plus({ minutes: (c + 1) * STEP }).toMillis();
          if (b.start < e && b.end > s) busyCells.add(c);
        }
      }
      days.push({ date, label: day.toFormat("ccc d"), isPast: day < today, cells, weeklyCells: me.availabilityMode === "painted" ? [] : weeklyCells(rules, weekday), busyCells: [...busyCells] });
    }
  }
  const nav = (w: DateTime) => `/event-types/${et.id}?tab=availability&week=${w.toISODate()}`;

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="mb-2 font-medium">Hosts</h2>
        <ul className="space-y-1 text-sm">
          {hosts.map((h) => {
            const u = hostUsers.get(h.userDid);
            const n = summary.get(h.userDid) ?? 0;
            return (
              <li key={h.userDid} className="flex flex-wrap items-center gap-2">
                <span>{u ? `${displayName(u)} (@${u.handle})` : h.userDid}</span>
                <Badge tone={h.availabilityMode === "painted" ? "accent" : "neutral"}>{h.availabilityMode === "painted" ? "painted times only" : "weekly hours + painted days"}</Badge>
                <span className="text-xs text-muted">{n ? `${n} upcoming day${n > 1 ? "s" : ""} painted` : "nothing painted yet"}</span>
                {h.userDid === user.did ? <Badge tone="ok">you</Badge> : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">
          Each host paints their own availability for this event from their account. Bookable times are computed from all hosts together, following the event&apos;s host mode
          ({et.assignmentMode === "collective" ? "everyone must be free" : et.assignmentMode === "anyone" ? "any one host free" : `at least ${et.thresholdCount} hosts free`}).
        </p>
      </section>

      {!me ? (
        <p className="text-sm text-muted">You are not a host of this event, so there is nothing to paint here.</p>
      ) : (
        <>
          <section className="card flex flex-wrap items-center justify-between gap-3">
            <form action={setEventAvailabilityModeAction} className="flex flex-wrap items-center gap-3 text-sm">
              <input type="hidden" name="eventTypeId" value={et.id} />
              <input type="hidden" name="week" value={weekStart.toISODate() ?? ""} />
              <label className="flex items-center gap-2">
                <input type="radio" name="mode" value="schedule" defaultChecked={me.availabilityMode === "schedule"} /> Start from my weekly hours; painted days replace them
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="mode" value="painted" defaultChecked={me.availabilityMode === "painted"} /> Only the times I paint here count for this event
              </label>
              <button className="btn-secondary px-2 py-1 text-xs">Apply</button>
            </form>
            <form action={clearEventPaintAction}>
              <input type="hidden" name="eventTypeId" value={et.id} />
              <button className="text-xs text-muted underline">Clear everything I painted</button>
            </form>
          </section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {weekStart.toFormat("d LLL")} – {weekStart.plus({ days: 6 }).toFormat("d LLL yyyy")} · times in {zone} · your <Link href="/availability" className="underline">weekly hours</Link> stay the baseline for other events
            </p>
            <div className="flex items-center gap-2 text-sm">
              <Link href={nav(weekStart.minus({ weeks: 1 }))} className="btn-secondary px-2 py-1">‹</Link>
              <Link href={`/event-types/${et.id}?tab=availability`} className="btn-secondary px-2 py-1">Today</Link>
              <Link href={nav(weekStart.plus({ weeks: 1 }))} className="btn-secondary px-2 py-1">›</Link>
            </div>
          </div>
          <WeekPainter key={weekStart.toISODate()} target={{ kind: "event", eventTypeId: et.id }} days={days} resetLabel={me.availabilityMode === "painted" ? "clear" : "weekly"} />
        </>
      )}
    </div>
  );
}
