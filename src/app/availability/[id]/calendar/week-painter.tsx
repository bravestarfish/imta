"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePaintedDaysAction, saveEventPaintAction } from "@/app/actions/availability";

export type PainterDay = { date: string; label: string; isPast: boolean; cells: number[]; weeklyCells: number[]; busyCells: number[] };
export type PainterTarget = { kind: "schedule"; scheduleId: string } | { kind: "event"; eventTypeId: string };

const hm = (cell: number) => `${String(Math.floor((cell * 30) / 60)).padStart(2, "0")}:${cell % 2 ? "30" : "00"}`;

export function WeekPainter({ target, days, resetLabel = "weekly" }: { target: PainterTarget; days: PainterDay[]; resetLabel?: string }) {
  const [state, setState] = useState<Record<string, Set<number>>>(() => Object.fromEntries(days.map((d) => [d.date, new Set(d.cells)])));
  const [allHours, setAllHours] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const paint = useRef<{ value: boolean; touched: Set<string> } | null>(null);
  const busy = useMemo(() => Object.fromEntries(days.map((d) => [d.date, new Set(d.busyCells)])), [days]);

  const rows = useMemo(() => {
    const from = allHours ? 0 : 12; // 06:00
    const to = allHours ? 48 : 44; // 22:00
    return Array.from({ length: to - from }, (_, i) => from + i);
  }, [allHours]);

  const dirty = days.filter((d) => {
    const a = [...state[d.date]].sort((x, y) => x - y);
    const b = [...d.cells].sort((x, y) => x - y);
    return a.length !== b.length || a.some((v, i) => v !== b[i]);
  });

  const setCell = (date: string, cell: number, value: boolean) =>
    setState((s) => {
      const next = new Set(s[date]);
      if (value) next.add(cell);
      else next.delete(cell);
      return { ...s, [date]: next };
    });

  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const target = el?.closest<HTMLElement>("[data-cell]");
    if (!target) return null;
    return { date: target.dataset.date!, cell: Number(target.dataset.cell) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const hit = cellAt(e.clientX, e.clientY);
    if (!hit) return;
    const day = days.find((d) => d.date === hit.date);
    if (!day || day.isPast) return;
    const value = !state[hit.date].has(hit.cell);
    paint.current = { value, touched: new Set([`${hit.date}:${hit.cell}`]) };
    setCell(hit.date, hit.cell, value);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!paint.current) return;
    const hit = cellAt(e.clientX, e.clientY);
    if (!hit) return;
    const key = `${hit.date}:${hit.cell}`;
    if (paint.current.touched.has(key)) return;
    const day = days.find((d) => d.date === hit.date);
    if (!day || day.isPast) return;
    paint.current.touched.add(key);
    setCell(hit.date, hit.cell, paint.current.value);
  };
  const onPointerUp = () => {
    paint.current = null;
  };

  const save = () =>
    start(async () => {
      const payload = dirty.map((d) => ({ date: d.date, cells: [...state[d.date]] }));
      const res = target.kind === "schedule" ? await savePaintedDaysAction({ scheduleId: target.scheduleId, days: payload }) : await saveEventPaintAction({ eventTypeId: target.eventTypeId, days: payload });
      setMessage(res.ok ? { kind: "ok", text: "Saved." } : { kind: "error", text: res.error });
      if (res.ok) router.refresh();
    });

  const resetDay = (date: string) => {
    const d = days.find((x) => x.date === date)!;
    setState((s) => ({ ...s, [date]: new Set(d.weeklyCells) }));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-accent" /> available</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm border border-border" /> not available</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,var(--muted)_2px,var(--muted)_3px)]" /> busy in your calendar</span>
        <label className="ml-auto inline-flex items-center gap-1"><input type="checkbox" checked={allHours} onChange={(e) => setAllHours(e.target.checked)} /> show all hours</label>
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[560px] select-none"
          style={{ gridTemplateColumns: "3rem repeat(7, minmax(0, 1fr))", touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div />
          {days.map((d) => (
            <div key={d.date} className={`pb-1 text-center text-xs ${d.isPast ? "text-muted" : "font-medium"}`}>
              {d.label}
              <button type="button" className="block w-full text-[10px] text-muted underline" onClick={() => resetDay(d.date)} disabled={d.isPast}>
                {resetLabel}
              </button>
            </div>
          ))}
          {rows.map((cell) => (
            <div key={cell} className="contents">
              <div className={`pr-1 text-right text-[10px] leading-none text-muted ${cell % 2 === 0 ? "" : "invisible"}`} style={{ height: 18 }}>
                {hm(cell)}
              </div>
              {days.map((d) => {
                const on = state[d.date].has(cell);
                const isBusy = busy[d.date].has(cell);
                return (
                  <div
                    key={d.date + cell}
                    data-cell={cell}
                    data-date={d.date}
                    className={`border-r border-border ${cell % 2 === 0 ? "border-t" : "border-t border-t-border/40"} ${d.isPast ? "opacity-40" : "cursor-pointer"}`}
                    style={{
                      height: 18,
                      background: on
                        ? isBusy
                          ? "repeating-linear-gradient(45deg, var(--accent), var(--accent) 2px, color-mix(in oklab, var(--accent) 50%, transparent) 2px, color-mix(in oklab, var(--accent) 50%, transparent) 4px)"
                          : "var(--accent)"
                        : isBusy
                          ? "repeating-linear-gradient(45deg, transparent, transparent 2px, var(--muted) 2px, var(--muted) 3px)"
                          : undefined,
                    }}
                    title={`${d.label} ${hm(cell)}${isBusy ? " (busy in calendar)" : ""}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={pending || !dirty.length} onClick={save}>
          {pending ? "Saving…" : dirty.length ? `Save ${dirty.length} day${dirty.length > 1 ? "s" : ""}` : "No changes"}
        </button>
        {message ? <span className={`text-sm ${message.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{message.text}</span> : null}
        <span className="text-xs text-muted">Busy calendar time is always excluded from bookable slots, even where you paint yourself available.</span>
      </div>
    </div>
  );
}
