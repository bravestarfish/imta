import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { listSchedules } from "@/lib/availability/service";
import { createScheduleAction } from "@/app/actions/availability";
import { Badge, PageHeader } from "@/components/ui";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function Availability() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/availability");
  const schedules = await listSchedules(user.did);
  return (
    <div>
      <PageHeader
        title="Availability"
        description="Set weekly working hours, then fine-tune specific days in the week view by tapping half-hour cells. Busy times from connected calendars are removed automatically."
        actions={
          <form action={createScheduleAction} className="flex gap-2">
            <input name="name" className="input" placeholder="e.g. Evenings" />
            <button className="btn-secondary whitespace-nowrap">New schedule</button>
          </form>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {schedules.map((s) => (
          <div key={s.id} className="card">
            <div className="flex items-center justify-between">
              <Link href={`/availability/${s.id}`} className="font-medium hover:underline">{s.name}</Link>
              {s.isDefault ? <Badge tone="accent">default</Badge> : null}
            </div>
            <div className="mt-1 text-xs text-muted">{s.timezone}</div>
            <ul className="mt-3 space-y-0.5 text-sm">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const rules = s.rules.filter((r) => r.weekday === d).sort((a, b) => a.startMinutes - b.startMinutes);
                return (
                  <li key={d} className="flex gap-3">
                    <span className="w-8 text-muted">{DAYS[d]}</span>
                    <span>{rules.length ? rules.map((r) => `${hm(r.startMinutes)}–${hm(r.endMinutes)}`).join(", ") : <span className="text-muted">off</span>}</span>
                  </li>
                );
              })}
            </ul>
            {s.overrides.length ? <div className="mt-2 text-xs text-muted">{s.overrides.length} date override{s.overrides.length > 1 ? "s" : ""}</div> : null}
            <div className="mt-3 flex gap-2">
              <Link href={`/availability/${s.id}/calendar`} className="btn-primary px-2 py-1 text-xs">Week view</Link>
              <Link href={`/availability/${s.id}`} className="btn-secondary px-2 py-1 text-xs">Weekly hours</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
