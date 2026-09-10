"use client";

import { useState, useTransition } from "react";
import { saveScheduleAction } from "@/app/actions/availability";

type Rule = { weekday: number; startMinutes: number; endMinutes: number };
type Override = { date: string; startMinutes: number | null; endMinutes: number | null; unavailable: boolean };
type State = { name: string; timezone: string; isDefault: boolean; rules: Rule[]; overrides: Override[] };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromHM = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export function ScheduleEditor({ id, initial, timezones }: { id: string; initial: State; timezones: string[] }) {
  const [state, setState] = useState<State>(initial);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  const rulesFor = (d: number) => state.rules.filter((r) => r.weekday === d).sort((a, b) => a.startMinutes - b.startMinutes);
  const setRules = (d: number, rules: Rule[]) => update({ rules: [...state.rules.filter((r) => r.weekday !== d), ...rules] });

  const save = () =>
    start(async () => {
      const res = await saveScheduleAction(id, state);
      setMessage(res.ok ? { kind: "ok", text: "Saved." } : { kind: "error", text: res.error });
    });

  return (
    <div className="space-y-6">
      {message ? <div className={`rounded-md border px-3 py-2 text-sm ${message.kind === "ok" ? "border-emerald-300 text-emerald-700" : "border-red-300 text-red-700"}`}>{message.text}</div> : null}
      <div className="card grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="label">Name</span>
          <input className="input" value={state.name} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Time zone</span>
          <select className="input" value={state.timezone} onChange={(e) => update({ timezone: e.target.value })}>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={state.isDefault} onChange={(e) => update({ isDefault: e.target.checked })} disabled={initial.isDefault} /> Default schedule
        </label>
      </div>

      <div className="card space-y-3">
        <h2 className="font-medium">Weekly hours</h2>
        {ORDER.map((d) => {
          const rules = rulesFor(d);
          return (
            <div key={d} className="flex flex-wrap items-start gap-3 border-t border-border pt-3 first:border-0">
              <label className="flex w-32 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={rules.length > 0}
                  onChange={(e) => setRules(d, e.target.checked ? [{ weekday: d, startMinutes: 540, endMinutes: 1020 }] : [])}
                />
                {DAYS[d]}
              </label>
              <div className="flex flex-1 flex-col gap-2">
                {rules.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <input type="time" className="input w-32" value={toHM(r.startMinutes)} step={300} onChange={(e) => setRules(d, rules.map((x, j) => (j === i ? { ...x, startMinutes: fromHM(e.target.value) } : x)))} />
                    <span>–</span>
                    <input type="time" className="input w-32" value={toHM(r.endMinutes)} step={300} onChange={(e) => setRules(d, rules.map((x, j) => (j === i ? { ...x, endMinutes: fromHM(e.target.value) } : x)))} />
                    <button type="button" className="text-xs text-muted underline" onClick={() => setRules(d, rules.filter((_, j) => j !== i))}>remove</button>
                    {i === rules.length - 1 ? (
                      <button type="button" className="text-xs underline" onClick={() => setRules(d, [...rules, { weekday: d, startMinutes: Math.min(r.endMinutes + 60, 1380), endMinutes: Math.min(r.endMinutes + 180, 1440) }])}>
                        add window
                      </button>
                    ) : null}
                  </div>
                ))}
                {!rules.length ? <span className="text-sm text-muted">Unavailable</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card space-y-3">
        <h2 className="font-medium">Date overrides</h2>
        <p className="text-sm text-muted">Holidays, travel days, or a one-off different window. An override replaces the weekly hours for that date.</p>
        {state.overrides.map((o, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="date" className="input w-40" value={o.date} onChange={(e) => update({ overrides: state.overrides.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={o.unavailable} onChange={(e) => update({ overrides: state.overrides.map((x, j) => (j === i ? { ...x, unavailable: e.target.checked } : x)) })} /> unavailable all day
            </label>
            {!o.unavailable ? (
              <>
                <input type="time" className="input w-32" value={toHM(o.startMinutes ?? 540)} onChange={(e) => update({ overrides: state.overrides.map((x, j) => (j === i ? { ...x, startMinutes: fromHM(e.target.value) } : x)) })} />
                <span>–</span>
                <input type="time" className="input w-32" value={toHM(o.endMinutes ?? 1020)} onChange={(e) => update({ overrides: state.overrides.map((x, j) => (j === i ? { ...x, endMinutes: fromHM(e.target.value) } : x)) })} />
              </>
            ) : null}
            <button type="button" className="text-xs text-muted underline" onClick={() => update({ overrides: state.overrides.filter((_, j) => j !== i) })}>remove</button>
          </div>
        ))}
        <button type="button" className="btn-secondary" onClick={() => update({ overrides: [...state.overrides, { date: new Date().toISOString().slice(0, 10), startMinutes: 540, endMinutes: 1020, unavailable: true }] })}>
          Add override
        </button>
      </div>

      <div className="flex gap-2">
        <button type="button" className="btn-primary" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save schedule"}</button>
      </div>
    </div>
  );
}
