import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DateTime } from "luxon";
import { getCurrentUser } from "@/lib/auth/session";
import { getSchedule } from "@/lib/availability/service";
import { busyFor } from "@/lib/calendar/service";
import { effectiveCells, weeklyCells, STEP } from "@/lib/availability/painter";
import { PageHeader } from "@/components/ui";
import { WeekPainter, type PainterDay } from "./week-painter";

export default async function ScheduleCalendar({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ week?: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  const { week } = await searchParams;
  if (!user) redirect(`/login?next=/availability/${id}/calendar`);
  const schedule = await getSchedule(user.did, id);
  if (!schedule) notFound();
  const zone = schedule.timezone;
  const today = DateTime.now().setZone(zone).startOf("day");
  const weekStart = (week ? DateTime.fromISO(week, { zone }) : today).startOf("week"); // Monday
  const window = { start: weekStart.toMillis(), end: weekStart.plus({ days: 7 }).toMillis() };
  const busy = (await busyFor([user.did], window)).get(user.did) ?? [];

  const days: PainterDay[] = [];
  for (let i = 0; i < 7; i++) {
    const day = weekStart.plus({ days: i });
    const date = day.toISODate()!;
    const weekday = day.weekday % 7;
    const busyCells = new Set<number>();
    for (const b of busy) {
      // Map busy intervals to this day's half-hour cells (wall clock in the schedule's zone).
      for (let c = 0; c < 48; c++) {
        const s = day.plus({ minutes: c * STEP }).toMillis();
        const e = day.plus({ minutes: (c + 1) * STEP }).toMillis();
        if (b.start < e && b.end > s) busyCells.add(c);
      }
    }
    days.push({
      date,
      label: day.toFormat("ccc d"),
      isPast: day < today,
      cells: effectiveCells(schedule.rules, schedule.overrides, date, weekday),
      weeklyCells: weeklyCells(schedule.rules, weekday),
      busyCells: [...busyCells],
    });
  }

  return (
    <div>
      <PageHeader
        title={`${schedule.name}: week view`}
        description={
          <>
            Tap or drag over half-hour cells to mark when you are available on specific days. Changes are stored as date overrides on top of your{" "}
            <Link href={`/availability/${id}`} className="underline">weekly hours</Link>. Times in {zone}.
          </>
        }
        actions={
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/availability/${id}/calendar?week=${weekStart.minus({ weeks: 1 }).toISODate()}`} className="btn-secondary px-2 py-1">‹</Link>
            <Link href={`/availability/${id}/calendar`} className="btn-secondary px-2 py-1">Today</Link>
            <Link href={`/availability/${id}/calendar?week=${weekStart.plus({ weeks: 1 }).toISODate()}`} className="btn-secondary px-2 py-1">›</Link>
          </div>
        }
      />
      <p className="mb-3 text-sm text-muted">{weekStart.toFormat("d LLL")} – {weekStart.plus({ days: 6 }).toFormat("d LLL yyyy")}</p>
      <WeekPainter key={weekStart.toISODate()} target={{ kind: "schedule", scheduleId: id }} days={days} />
    </div>
  );
}
