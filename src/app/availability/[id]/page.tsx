import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSchedule } from "@/lib/availability/service";
import { deleteScheduleAction } from "@/app/actions/availability";
import { PageHeader, TIMEZONES } from "@/components/ui";
import { ScheduleEditor } from "./editor";

export default async function EditSchedule({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/availability");
  const { id } = await params;
  const schedule = await getSchedule(user.did, id);
  if (!schedule) notFound();
  return (
    <div>
      <PageHeader
        title={schedule.name}
        description="Set weekly hours and date-specific overrides. Times are in the schedule's time zone."
        actions={
          <>
          <Link href={`/availability/${schedule.id}/calendar`} className="btn-secondary">Week view</Link>
          {!schedule.isDefault ? (
            <form action={deleteScheduleAction}>
              <input type="hidden" name="id" value={schedule.id} />
              <button className="btn-danger">Delete</button>
            </form>
          ) : null}
          </>
        }
      />
      <ScheduleEditor
        id={schedule.id}
        initial={{ name: schedule.name, timezone: schedule.timezone, isDefault: schedule.isDefault, rules: schedule.rules, overrides: schedule.overrides.map((o) => ({ ...o, startMinutes: o.startMinutes ?? null, endMinutes: o.endMinutes ?? null, unavailable: Boolean(o.unavailable) })) }}
        timezones={TIMEZONES}
      />
    </div>
  );
}
