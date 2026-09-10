"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEventTypeAction } from "@/app/actions/event-types";

export type HostOption = { did: string; label: string; schedules: { id: string; name: string }[] };

type Question = { id: string; label: string; type: "text" | "textarea" | "select" | "checkbox"; required: boolean; options?: string[] };
type Form = {
  title: string;
  slug: string;
  description: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxBookingsPerDay: number | null;
  bookingWindowDays: number;
  capacity: number;
  visibility: "public" | "link" | "invite";
  assignmentMode: "collective" | "anyone" | "threshold";
  thresholdCount: number;
  hostSelection: "round_robin" | "least_booked";
  locationKind: "video" | "inperson" | "phone" | "custom";
  videoProvider: "auto" | "google_meet" | "zoom" | "jitsi" | "none";
  locationText: string;
  status: "draft" | "published" | "archived";
  cancellationNoticeMinutes: number;
  allowReschedule: boolean;
  requiresApproval: boolean;
  reminderMinutes: number[];
  publishSessions: boolean;
  color: string;
  questions: Question[];
  hosts: { did: string; scheduleId: string | null; required: boolean }[];
};

const defaults = (hosts: HostOption[]): Form => ({
  title: "",
  slug: "",
  description: "",
  durationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 10,
  minNoticeMinutes: 240,
  maxBookingsPerDay: null,
  bookingWindowDays: 60,
  capacity: 1,
  visibility: "link",
  assignmentMode: "collective",
  thresholdCount: 2,
  hostSelection: "round_robin",
  locationKind: "video",
  videoProvider: "auto",
  locationText: "",
  status: "draft",
  cancellationNoticeMinutes: 0,
  allowReschedule: true,
  requiresApproval: false,
  reminderMinutes: [1440, 60],
  publishSessions: false,
  color: "#4f46e5",
  questions: [],
  hosts: hosts.slice(0, 1).map((h) => ({ did: h.did, scheduleId: null, required: true })),
});

export function EventTypeForm({ id, ownerKind, ownerId, hosts, initial }: { id: string | null; ownerKind: "user" | "team"; ownerId: string; hosts: HostOption[]; initial: Partial<Form> | null }) {
  const [f, setF] = useState<Form>({ ...defaults(hosts), ...(initial ?? {}) });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const num = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, (e.target.value === "" ? null : Number(e.target.value)) as never);

  const submit = (status?: Form["status"]) =>
    start(async () => {
      setError(null);
      const payload = { ...f, status: status ?? f.status, slug: f.slug || undefined, maxBookingsPerDay: f.maxBookingsPerDay || null };
      const res = await saveEventTypeAction(id, ownerKind, ownerId, payload);
      if (!res.ok) setError(res.error);
      else if (!id) router.push(`/event-types/${res.id}`);
      else {
        setF((s) => ({ ...s, status: payload.status }));
        router.refresh();
      }
    });

  const toggleHost = (did: string, on: boolean) =>
    set("hosts", on ? [...f.hosts, { did, scheduleId: null, required: true }] : f.hosts.filter((h) => h.did !== did));

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <section className="card grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">Title</span>
          <input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="30 minute intro call" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Description</span>
          <textarea className="input" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} />
        </label>
        <label className="block">
          <span className="label">URL slug</span>
          <input className="input" value={f.slug} onChange={(e) => set("slug", e.target.value)} placeholder="intro-call" />
        </label>
        <label className="block">
          <span className="label">Colour</span>
          <input type="color" className="input h-10" value={f.color} onChange={(e) => set("color", e.target.value)} />
        </label>
      </section>

      <section className="card grid gap-4 sm:grid-cols-3">
        <h2 className="font-medium sm:col-span-3">Duration and limits</h2>
        <label className="block"><span className="label">Duration (min)</span><input type="number" min={5} step={5} className="input" value={f.durationMinutes} onChange={num("durationMinutes")} /></label>
        <label className="block"><span className="label">Slot interval (min)</span><input type="number" min={5} step={5} className="input" value={f.slotIntervalMinutes} onChange={num("slotIntervalMinutes")} /></label>
        <label className="block"><span className="label">Booking window (days)</span><input type="number" min={1} className="input" value={f.bookingWindowDays} onChange={num("bookingWindowDays")} /></label>
        <label className="block"><span className="label">Buffer before (min)</span><input type="number" min={0} step={5} className="input" value={f.bufferBeforeMinutes} onChange={num("bufferBeforeMinutes")} /></label>
        <label className="block"><span className="label">Buffer after (min)</span><input type="number" min={0} step={5} className="input" value={f.bufferAfterMinutes} onChange={num("bufferAfterMinutes")} /></label>
        <label className="block"><span className="label">Minimum notice (min)</span><input type="number" min={0} step={15} className="input" value={f.minNoticeMinutes} onChange={num("minNoticeMinutes")} /></label>
        <label className="block"><span className="label">Max bookings per day</span><input type="number" min={1} className="input" value={f.maxBookingsPerDay ?? ""} onChange={num("maxBookingsPerDay")} placeholder="unlimited" /></label>
        <label className="block"><span className="label">Seats per session</span><input type="number" min={1} className="input" value={f.capacity} onChange={num("capacity")} /><span className="hint">1 for one-to-one; more for group sessions.</span></label>
        <label className="block"><span className="label">Cancellation notice (min)</span><input type="number" min={0} step={30} className="input" value={f.cancellationNoticeMinutes} onChange={num("cancellationNoticeMinutes")} /><span className="hint">0 = attendees can cancel any time.</span></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.allowReschedule} onChange={(e) => set("allowReschedule", e.target.checked)} /> Attendees can reschedule</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requiresApproval} onChange={(e) => set("requiresApproval", e.target.checked)} /> Bookings need host approval</label>
        <label className="block"><span className="label">Reminders (minutes before, comma separated)</span><input className="input" value={f.reminderMinutes.join(", ")} onChange={(e) => set("reminderMinutes", e.target.value.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0))} /></label>
      </section>

      <section className="card grid gap-4 sm:grid-cols-2">
        <h2 className="font-medium sm:col-span-2">Access</h2>
        <label className="block">
          <span className="label">Visibility</span>
          <select className="input" value={f.visibility} onChange={(e) => set("visibility", e.target.value as Form["visibility"])}>
            <option value="public">Public: listed on the booking profile and published to your Atmosphere repository</option>
            <option value="link">Anyone with the link</option>
            <option value="invite">Invitation only (specific Atmosphere accounts)</option>
          </select>
        </label>
        {f.capacity > 1 && f.visibility === "public" ? (
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" checked={f.publishSessions} onChange={(e) => set("publishSessions", e.target.checked)} /> Publish sessions as public Atmosphere calendar events (visible in atmo.rsvp and similar apps)
          </label>
        ) : null}
      </section>

      <section className="card grid gap-4 sm:grid-cols-2">
        <h2 className="font-medium sm:col-span-2">Location</h2>
        <label className="block">
          <span className="label">Kind</span>
          <select className="input" value={f.locationKind} onChange={(e) => set("locationKind", e.target.value as Form["locationKind"])}>
            <option value="video">Video call</option>
            <option value="inperson">In person</option>
            <option value="phone">Phone</option>
            <option value="custom">Custom text</option>
          </select>
        </label>
        {f.locationKind === "video" ? (
          <label className="block">
            <span className="label">Video provider</span>
            <select className="input" value={f.videoProvider} onChange={(e) => set("videoProvider", e.target.value as Form["videoProvider"])}>
              <option value="auto">Automatic (Google Meet, then Zoom, then Jitsi)</option>
              <option value="google_meet">Google Meet (needs Google Calendar connected)</option>
              <option value="zoom">Zoom (needs Zoom connected)</option>
              <option value="jitsi">Jitsi (no account needed)</option>
              <option value="none">No link</option>
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="label">{f.locationKind === "phone" ? "Phone number or note" : "Address or details"}</span>
            <input className="input" value={f.locationText} onChange={(e) => set("locationText", e.target.value)} />
          </label>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">Hosts</h2>
        {ownerKind === "team" ? (
          <>
            <label className="block">
              <span className="label">Who attends</span>
              <select className="input" value={f.assignmentMode} onChange={(e) => set("assignmentMode", e.target.value as Form["assignmentMode"])}>
                <option value="collective">All selected hosts (only times when everyone is free)</option>
                <option value="anyone">Any one host (times when at least one is free; the booker does not see who)</option>
                <option value="threshold">At least N hosts</option>
              </select>
            </label>
            {f.assignmentMode === "threshold" ? (
              <label className="block"><span className="label">N</span><input type="number" min={1} className="input w-24" value={f.thresholdCount} onChange={num("thresholdCount")} /></label>
            ) : null}
            <ul className="space-y-2">
              {hosts.map((h) => {
                const sel = f.hosts.find((x) => x.did === h.did);
                return (
                  <li key={h.did} className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(sel)} onChange={(e) => toggleHost(h.did, e.target.checked)} /> {h.label}</label>
                    {sel ? (
                      <select className="input w-auto" value={sel.scheduleId ?? ""} onChange={(e) => set("hosts", f.hosts.map((x) => (x.did === h.did ? { ...x, scheduleId: e.target.value || null } : x)))}>
                        <option value="">default schedule</option>
                        {h.schedules.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <label className="block">
            <span className="label">Schedule</span>
            <select className="input" value={f.hosts[0]?.scheduleId ?? ""} onChange={(e) => set("hosts", [{ did: hosts[0].did, scheduleId: e.target.value || null, required: true }])}>
              <option value="">default schedule</option>
              {hosts[0]?.schedules.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">Booking questions</h2>
        <p className="text-sm text-muted">Name and email are always asked. Add anything else you need.</p>
        {f.questions.map((q, i) => (
          <div key={q.id} className="flex flex-wrap items-center gap-2 text-sm">
            <input className="input w-64" value={q.label} placeholder="Question" onChange={(e) => set("questions", f.questions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <select className="input w-auto" value={q.type} onChange={(e) => set("questions", f.questions.map((x, j) => (j === i ? { ...x, type: e.target.value as Question["type"] } : x)))}>
              <option value="text">Short text</option>
              <option value="textarea">Long text</option>
              <option value="select">Choice</option>
              <option value="checkbox">Checkbox</option>
            </select>
            {q.type === "select" ? (
              <input className="input w-64" placeholder="Options, comma separated" value={(q.options ?? []).join(", ")} onChange={(e) => set("questions", f.questions.map((x, j) => (j === i ? { ...x, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : x)))} />
            ) : null}
            <label className="flex items-center gap-1"><input type="checkbox" checked={q.required} onChange={(e) => set("questions", f.questions.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} /> required</label>
            <button type="button" className="text-xs text-muted underline" onClick={() => set("questions", f.questions.filter((_, j) => j !== i))}>remove</button>
          </div>
        ))}
        <button type="button" className="btn-secondary" onClick={() => set("questions", [...f.questions, { id: `q${Date.now().toString(36)}`, label: "", type: "text", required: false }])}>Add question</button>
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={pending} onClick={() => submit("published")}>{pending ? "Saving…" : f.status === "published" ? "Save" : "Save and publish"}</button>
        {f.status !== "published" ? <button type="button" className="btn-secondary" disabled={pending} onClick={() => submit("draft")}>Save as draft</button> : <button type="button" className="btn-secondary" disabled={pending} onClick={() => submit("draft")}>Unpublish</button>}
        {id ? <button type="button" className="btn-secondary" disabled={pending} onClick={() => submit("archived")}>Archive</button> : null}
      </div>
    </div>
  );
}
