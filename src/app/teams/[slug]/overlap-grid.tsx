import { DateTime } from "luxon";
import type { Interval } from "@/lib/scheduling/intervals";

/**
 * Server-rendered week grid: one column per day, rows per hour, cells shaded
 * by how many members are free (computed overlap only).
 */
export function OverlapGrid({ weekStartMs, zone, members, byMember, all, atLeast }: { weekStartMs: number; zone: string; members: { did: string; name: string }[]; byMember: Record<string, Interval[]>; all: Interval[]; atLeast: Record<number, Interval[]> }) {
  const start = DateTime.fromMillis(weekStartMs, { zone });
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  const hours = Array.from({ length: 15 }, (_, i) => i + 7); // 07:00 – 21:00
  const n = members.length;
  const countFree = (t: number, dur: number) => members.filter((m) => (byMember[m.did] ?? []).some((iv) => iv.start <= t && iv.end >= t + dur)).length;
  void all;
  void atLeast;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-xs">
        <thead>
          <tr>
            <th className="w-12"></th>
            {days.map((d) => (
              <th key={d.toISODate()} className="pb-1 font-medium">{d.toFormat("ccc d")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hours.map((h) => (
            <tr key={h}>
              <td className="pr-2 text-right text-muted">{String(h).padStart(2, "0")}:00</td>
              {days.map((d) => {
                const t = d.set({ hour: h, minute: 0 }).toMillis();
                const free = countFree(t, 60 * 60_000);
                const ratio = n ? free / n : 0;
                const bg = free === 0 ? "transparent" : `color-mix(in oklab, var(--accent) ${Math.round(20 + ratio * 70)}%, transparent)`;
                return (
                  <td key={d.toISODate()} className="h-6 border border-border p-0" title={`${free}/${n} free`}>
                    <div className="h-full w-full" style={{ background: bg }}>
                      {free > 0 && free < n ? <span className="block text-center leading-6 text-[10px] opacity-80">{free}</span> : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted">Darker = more members free. Numbers show how many are free when it is not everyone.</p>
    </div>
  );
}
