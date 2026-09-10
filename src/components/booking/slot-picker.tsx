"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { bookAction, rescheduleAction, type BookResult } from "@/app/actions/bookings";

type Question = { id: string; label: string; type: "text" | "textarea" | "select" | "checkbox"; required: boolean; options?: string[] };
type Slot = { start: number; end: number };
type Session = { id: string; start: number; end: number; seatsLeft: number };

export type SlotPickerProps = {
  eventTypeId: string;
  durationMinutes: number;
  bookingWindowDays: number;
  capacity: number;
  questions: Question[];
  linkKey?: string | null;
  timezones: string[];
  viewer: { name: string; email: string; timezone: string } | null;
  /** Reschedule mode: only a time is picked. */
  reschedule?: { token: string };
  loginUrl: string;
};

export function SlotPicker(p: SlotPickerProps) {
  const [zone, setZone] = useState(p.viewer?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [month, setMonth] = useState(() => DateTime.now().setZone(zone).startOf("month"));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ start: number; meetingId?: string } | null>(null);
  const [result, setResult] = useState<BookResult | null>(null);
  const [pending, start] = useTransition();
  const [name, setName] = useState(p.viewer?.name ?? "");
  const [email, setEmail] = useState(p.viewer?.email ?? "");
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});

  const router = useRouter();
  const range = useMemo(() => ({ from: month.toMillis(), to: month.plus({ months: 1 }).plus({ days: 1 }).toMillis() }), [month]);

  useEffect(() => {
    const { from, to } = range;
    if (to <= from) return;
    const ctrl = new AbortController();
    const key = `${from}-${to}-${p.eventTypeId}`;
    const q = new URLSearchParams({ id: p.eventTypeId, from: String(from), to: String(to), ...(p.linkKey ? { k: p.linkKey } : {}) });
    fetch(`/api/slots?${q}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: { slots?: Slot[]; sessions?: Session[] }) => {
        setSlots(d.slots ?? []);
        setSessions(d.sessions ?? []);
        setLoadedKey(key);
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [range, p.eventTypeId, p.linkKey]);

  const loading = loadedKey !== `${range.from}-${range.to}-${p.eventTypeId}`;

  const byDay = useMemo(() => {
    const m = new Map<string, { slots: Slot[]; sessions: Session[] }>();
    for (const s of slots) {
      const k = DateTime.fromMillis(s.start, { zone }).toISODate()!;
      (m.get(k) ?? m.set(k, { slots: [], sessions: [] }).get(k)!).slots.push(s);
    }
    for (const s of sessions) {
      const k = DateTime.fromMillis(s.start, { zone }).toISODate()!;
      (m.get(k) ?? m.set(k, { slots: [], sessions: [] }).get(k)!).sessions.push(s);
    }
    return m;
  }, [slots, sessions, zone]);

  const days = useMemo(() => {
    const first = month.startOf("month");
    const offset = (first.weekday + 6) % 7; // Monday first
    const list: (DateTime | null)[] = Array(offset).fill(null);
    for (let d = first; d.month === first.month; d = d.plus({ days: 1 })) list.push(d);
    return list;
  }, [month]);

  const submit = () =>
    start(async () => {
      if (!picked) return;
      const res = p.reschedule
        ? await rescheduleAction({ token: p.reschedule.token, start: picked.start, timezone: zone })
        : await bookAction({ eventTypeId: p.eventTypeId, start: picked.start, meetingId: picked.meetingId, name, email, timezone: zone, linkKey: p.linkKey ?? undefined, answers });
      setResult(res);
      if (res.ok) router.push(`/b/${res.token}?${p.reschedule ? "rescheduled=1" : "new=1"}`);
    });

  if (!p.viewer && !p.reschedule) {
    return (
      <div className="card text-center">
        <p className="text-sm">Sign in with your ATProto account to see available times and book.</p>
        <a href={p.loginUrl} className="btn-primary mt-3">Sign in</a>
      </div>
    );
  }

  const dayInfo = day ? byDay.get(day) : undefined;
  const fmt = (t: number) => DateTime.fromMillis(t, { zone }).toFormat("HH:mm");

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" className="btn-secondary px-2 py-1" onClick={() => setMonth(month.minus({ months: 1 }))} disabled={month <= DateTime.now().setZone(zone).startOf("month")}>‹</button>
          <span className="font-medium">{month.toFormat("LLLL yyyy")}</span>
          <button type="button" className="btn-secondary px-2 py-1" onClick={() => setMonth(month.plus({ months: 1 }))} disabled={month.plus({ months: 1 }) > DateTime.now().plus({ days: p.bookingWindowDays })}>›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
            <div key={d} className="py-1 text-muted">{d}</div>
          ))}
          {days.map((d, i) => {
            if (!d) return <div key={`e${i}`} />;
            const k = d.toISODate()!;
            const has = byDay.has(k);
            return (
              <button
                key={k}
                type="button"
                disabled={!has}
                onClick={() => {
                  setDay(k);
                  setPicked(null);
                }}
                className={`rounded py-2 ${day === k ? "bg-accent text-accent-fg" : has ? "bg-accent/15 font-medium text-accent hover:bg-accent/25" : "text-muted opacity-50"}`}
              >
                {d.day}
              </button>
            );
          })}
        </div>
        {loading ? <p className="mt-2 text-xs text-muted">Loading times…</p> : null}
        <label className="mt-4 block text-xs">
          <span className="text-muted">Time zone</span>
          <select className="input mt-1" value={zone} onChange={(e) => { setZone(e.target.value); setDay(null); setPicked(null); }}>
            {!p.timezones.includes(zone) ? <option value={zone}>{zone}</option> : null}
            {p.timezones.map((tz) => (
              <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        {!day ? <p className="text-sm text-muted">Pick a day to see times.</p> : null}
        {day && !picked ? (
          <>
            <h3 className="mb-2 font-medium">{DateTime.fromISO(day, { zone }).toFormat("cccc d LLLL")}</h3>
            {dayInfo?.sessions.length ? (
              <div className="mb-3">
                <p className="mb-1 text-xs text-muted">Sessions with free seats</p>
                <div className="flex flex-wrap gap-2">
                  {dayInfo.sessions.map((s) => (
                    <button key={s.id} type="button" className="btn-secondary" onClick={() => setPicked({ start: s.start, meetingId: s.id })}>
                      {fmt(s.start)} <span className="text-xs text-muted">({s.seatsLeft} left)</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {dayInfo?.slots.map((s) => (
                <button key={s.start} type="button" className="btn-secondary" onClick={() => setPicked({ start: s.start })}>
                  {fmt(s.start)}
                </button>
              ))}
            </div>
            {!dayInfo?.slots.length && !dayInfo?.sessions.length ? <p className="text-sm text-muted">No times that day.</p> : null}
          </>
        ) : null}
        {picked ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{DateTime.fromMillis(picked.start, { zone }).toFormat("cccc d LLLL, HH:mm")} – {DateTime.fromMillis(picked.start + p.durationMinutes * 60_000, { zone }).toFormat("HH:mm")}</div>
                <div className="text-xs text-muted">{zone}</div>
              </div>
              <button type="button" className="text-xs underline" onClick={() => setPicked(null)}>change</button>
            </div>
            {!p.reschedule ? (
              <>
                <label className="block"><span className="label">Your name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
                <label className="block"><span className="label">Email</span><input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required /><span className="hint">For the calendar invitation and reminders.</span></label>
                {p.questions.map((q) => (
                  <label key={q.id} className="block">
                    {q.type === "checkbox" ? (
                      <span className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(answers[q.id])} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.checked })} /> {q.label}{q.required ? " *" : ""}</span>
                    ) : (
                      <>
                        <span className="label">{q.label}{q.required ? " *" : ""}</span>
                        {q.type === "textarea" ? (
                          <textarea className="input" rows={3} value={String(answers[q.id] ?? "")} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} required={q.required} />
                        ) : q.type === "select" ? (
                          <select className="input" value={String(answers[q.id] ?? "")} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} required={q.required}>
                            <option value="">Choose…</option>
                            {(q.options ?? []).map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <input className="input" value={String(answers[q.id] ?? "")} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} required={q.required} />
                        )}
                      </>
                    )}
                  </label>
                ))}
              </>
            ) : null}
            {result && !result.ok ? <p className="text-sm text-red-600">{result.error}</p> : null}
            <button className="btn-primary w-full" disabled={pending}>{pending ? "Booking…" : p.reschedule ? "Move booking" : "Confirm booking"}</button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
