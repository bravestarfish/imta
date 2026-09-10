import { DateTime } from "luxon";

export function fmtRange(start: Date, end: Date, zone: string, locale = "en"): string {
  const s = DateTime.fromJSDate(start, { zone }).setLocale(locale);
  const e = DateTime.fromJSDate(end, { zone }).setLocale(locale);
  const sameDay = s.hasSame(e, "day");
  const date = s.toFormat("cccc d LLLL yyyy");
  const time = sameDay ? `${s.toFormat("HH:mm")} – ${e.toFormat("HH:mm")}` : `${s.toFormat("HH:mm")} – ${e.toFormat("d LLL HH:mm")}`;
  return `${date}, ${time} (${s.offsetNameShort ?? zone})`;
}

export function fmtDateTime(d: Date, zone: string, locale = "en"): string {
  return DateTime.fromJSDate(d, { zone }).setLocale(locale).toFormat("ccc d LLL yyyy, HH:mm ZZZZ");
}

export function fmtTime(d: Date, zone: string): string {
  return DateTime.fromJSDate(d, { zone }).toFormat("HH:mm");
}
