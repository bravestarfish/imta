import { providerFetch } from "./oauth";
import type { CalendarProvider, CalendarInfo, EventInput, SyncResult, WrittenEvent } from "./types";
import type { Interval } from "@/lib/scheduling/intervals";
import { appUrl, env } from "@/lib/env";
import { randomToken } from "@/lib/crypto";

const API = "https://graph.microsoft.com/v1.0";

type MCalendar = { id: string; name: string; isDefaultCalendar?: boolean; canEdit?: boolean };
type MEvent = {
  id: string;
  isCancelled?: boolean;
  showAs?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  onlineMeeting?: { joinUrl?: string };
  "@removed"?: { reason: string };
};

function graphDate(d: Date) {
  // Graph wants a local-looking dateTime plus timeZone; sending UTC keeps it unambiguous.
  return { dateTime: d.toISOString().replace("Z", ""), timeZone: "UTC" };
}

function parseGraphDate(v?: { dateTime: string; timeZone: string }): Date | undefined {
  if (!v) return undefined;
  // Graph returns UTC when Prefer: outlook.timezone="UTC" is set.
  return new Date(v.dateTime.endsWith("Z") ? v.dateTime : `${v.dateTime}Z`);
}

function toEventBody(input: EventInput) {
  return {
    subject: input.title,
    body: { contentType: "text", content: input.description },
    start: graphDate(input.start),
    end: graphDate(input.end),
    location: input.location ? { displayName: input.location } : undefined,
    attendees: input.attendees.map((a) => ({ emailAddress: { address: a.email, name: a.name }, type: "required" })),
    transactionId: input.icsUid,
    ...(input.createConference ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}),
  };
}

const UTC_HEADERS = { Prefer: 'outlook.timezone="UTC"' };

export const microsoft: CalendarProvider = {
  async listCalendars(conn) {
    const { data } = await providerFetch<{ value: MCalendar[] }>(conn, `${API}/me/calendars`);
    return (data.value ?? []).map<CalendarInfo>((c) => ({
      id: c.id,
      name: c.name,
      primary: Boolean(c.isDefaultCalendar),
      canWrite: c.canEdit !== false,
    }));
  },

  async accountInfo(conn) {
    const { data } = await providerFetch<{ id?: string; mail?: string; userPrincipalName?: string }>(conn, `${API}/me`);
    return { id: data.id, email: data.mail ?? data.userPrincipalName };
  },

  async freeBusy(conn, calendarIds, window) {
    // calendarView across each calendar; getSchedule needs the user's address which we may not have.
    const out: Interval[] = [];
    for (const calendarId of calendarIds) {
      const params = new URLSearchParams({
        startDateTime: new Date(window.start).toISOString(),
        endDateTime: new Date(window.end).toISOString(),
        $select: "start,end,showAs,isCancelled",
        $top: "500",
      });
      let url: string | undefined = `${API}/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${params}`;
      while (url) {
        const { data }: { data: { value: MEvent[]; "@odata.nextLink"?: string } } = await providerFetch<{ value: MEvent[]; "@odata.nextLink"?: string }>(conn, url, { headers: UTC_HEADERS });
        for (const ev of data.value ?? []) {
          if (ev.isCancelled || ev.showAs === "free") continue;
          const s = parseGraphDate(ev.start);
          const e = parseGraphDate(ev.end);
          if (s && e) out.push({ start: s.getTime(), end: e.getTime() });
        }
        url = data["@odata.nextLink"];
      }
    }
    return out;
  },

  async sync(conn, window, ownEventIds) {
    const calendarIds = conn.busyCalendarIds.length ? conn.busyCalendarIds : [conn.writeCalendarId ?? "default"];
    const result: SyncResult = { upserts: [], deletions: [], cursor: { ...conn.syncCursor }, changedOwnEvents: [], full: false };
    for (const calendarId of calendarIds) {
      const cursorKey = `m:${calendarId}`;
      let url: string | undefined = conn.syncCursor[cursorKey];
      let full = false;
      if (!url) {
        const params = new URLSearchParams({
          startDateTime: new Date(window.start).toISOString(),
          endDateTime: new Date(window.end).toISOString(),
        });
        const base = calendarId === "default" ? `${API}/me/calendarView/delta` : `${API}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta`;
        url = `${base}?${params}`;
        full = true;
      }
      while (url) {
        let res;
        try {
          res = await providerFetch<{ value: MEvent[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string }>(conn, url, {
            headers: UTC_HEADERS,
          });
        } catch (e) {
          if (e instanceof Error && /API 410/.test(e.message) && conn.syncCursor[cursorKey]) {
            // delta token expired: restart full sync for this calendar
            const params = new URLSearchParams({
              startDateTime: new Date(window.start).toISOString(),
              endDateTime: new Date(window.end).toISOString(),
            });
            url = `${API}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta?${params}`;
            full = true;
            continue;
          }
          throw e;
        }
        for (const ev of res.data.value ?? []) {
          const ext = `${calendarId}:${ev.id}`;
          const removed = Boolean(ev["@removed"]) || ev.isCancelled;
          if (ownEventIds.has(ev.id)) {
            result.changedOwnEvents.push({
              externalEventId: ev.id,
              deleted: Boolean(removed),
              start: parseGraphDate(ev.start),
              end: parseGraphDate(ev.end),
            });
            continue;
          }
          if (removed || ev.showAs === "free") {
            result.deletions.push(ext);
            continue;
          }
          const s = parseGraphDate(ev.start);
          const e = parseGraphDate(ev.end);
          if (s && e) result.upserts.push({ externalId: ext, start: s, end: e });
        }
        if (res.data["@odata.nextLink"]) {
          url = res.data["@odata.nextLink"];
          continue;
        }
        if (res.data["@odata.deltaLink"]) result.cursor[cursorKey] = res.data["@odata.deltaLink"];
        url = undefined;
      }
      result.full = result.full || full;
    }
    return result;
  },

  async createEvent(conn, calendarId, input) {
    const base = calendarId === "default" ? `${API}/me/events` : `${API}/me/calendars/${encodeURIComponent(calendarId)}/events`;
    const { data } = await providerFetch<MEvent>(conn, base, { method: "POST", json: toEventBody(input) });
    return { externalEventId: data.id, externalCalendarId: calendarId, conferenceUrl: data.onlineMeeting?.joinUrl };
  },

  async updateEvent(conn, calendarId, eventId, input) {
    const body = toEventBody(input);
    delete (body as { isOnlineMeeting?: boolean }).isOnlineMeeting;
    delete (body as { onlineMeetingProvider?: string }).onlineMeetingProvider;
    delete (body as { transactionId?: string }).transactionId;
    const { data } = await providerFetch<MEvent>(conn, `${API}/me/events/${encodeURIComponent(eventId)}`, { method: "PATCH", json: body });
    return { externalEventId: data.id, externalCalendarId: calendarId, conferenceUrl: data.onlineMeeting?.joinUrl } satisfies WrittenEvent;
  },

  async deleteEvent(conn, _calendarId, eventId) {
    try {
      await providerFetch(conn, `${API}/me/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
    } catch (e) {
      if (e instanceof Error && /API 404/.test(e.message)) return;
      throw e;
    }
  },

  async watch(conn, calendarId) {
    const secret = env().WEBHOOK_SECRET;
    if (!secret) return null;
    const resource = calendarId === "default" ? "/me/events" : `/me/calendars/${calendarId}/events`;
    const expiresAt = new Date(Date.now() + 2 * 86_400_000); // Graph allows ~3 days for events
    const { data } = await providerFetch<{ id: string }>(conn, `${API}/subscriptions`, {
      method: "POST",
      json: {
        changeType: "created,updated,deleted",
        notificationUrl: appUrl("/api/calendar/microsoft/webhook"),
        resource,
        expirationDateTime: expiresAt.toISOString(),
        clientState: secret,
      },
    });
    return { channelId: data.id, resourceId: randomToken(8), expiresAt };
  },

  async unwatch(conn) {
    if (!conn.watchChannelId) return;
    await providerFetch(conn, `${API}/subscriptions/${conn.watchChannelId}`, { method: "DELETE" }).catch(() => undefined);
  },
};
