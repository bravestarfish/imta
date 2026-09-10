/**
 * Minimal iCalendar generator (RFC 5545) for invitations and cancellations.
 * We generate ICS ourselves so that METHOD, SEQUENCE and STATUS are fully
 * under our control across create / reschedule / cancel.
 */
export type IcsEvent = {
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  organizer: { name: string; email: string };
  attendees: { name?: string; email: string; role?: "REQ-PARTICIPANT" | "OPT-PARTICIPANT" }[];
  method: "REQUEST" | "CANCEL";
  status?: "CONFIRMED" | "CANCELLED";
  createdAt?: Date;
};

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function buildIcs(ev: IcsEvent): string {
  const now = icsDate(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//imta//imta.rsvp//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${ev.method}`,
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `SEQUENCE:${ev.sequence}`,
    `DTSTAMP:${now}`,
    `DTSTART:${icsDate(ev.start)}`,
    `DTEND:${icsDate(ev.end)}`,
    `SUMMARY:${escapeText(ev.summary)}`,
    `STATUS:${ev.status ?? (ev.method === "CANCEL" ? "CANCELLED" : "CONFIRMED")}`,
    `ORGANIZER;CN=${escapeText(ev.organizer.name)}:mailto:${ev.organizer.email}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
  if (ev.url) lines.push(`URL:${ev.url}`);
  if (ev.createdAt) lines.push(`CREATED:${icsDate(ev.createdAt)}`);
  for (const a of ev.attendees) {
    const cn = a.name ? `;CN=${escapeText(a.name)}` : "";
    lines.push(`ATTENDEE;ROLE=${a.role ?? "REQ-PARTICIPANT"};PARTSTAT=${ev.method === "CANCEL" ? "DECLINED" : "ACCEPTED"};RSVP=FALSE${cn}:mailto:${a.email}`);
  }
  lines.push("BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(ev.summary)}`, "END:VALARM");
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
