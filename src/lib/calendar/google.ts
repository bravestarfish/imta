import { providerFetch } from "./oauth";
import type { CalendarProvider, CalendarInfo, EventInput, SyncResult, WrittenEvent } from "./types";
import type { Interval } from "@/lib/scheduling/intervals";
import { appUrl, env } from "@/lib/env";
import { randomToken } from "@/lib/crypto";

const API = "https://www.googleapis.com/calendar/v3";

type GCalendar = { id: string; summary: string; primary?: boolean; accessRole: string };
type GEvent = {
  id: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  transparency?: string;
  iCalUID?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
};

function toEventBody(input: EventInput) {
  return {
    summary: input.title,
    description: input.description,
    location: input.location,
    start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
    end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
    attendees: input.attendees.map((a) => ({ email: a.email, displayName: a.name })),
    iCalUID: input.icsUid,
    sequence: input.sequence,
    reminders: { useDefault: true },
    guestsCanSeeOtherGuests: true,
    ...(input.createConference
      ? { conferenceData: { createRequest: { requestId: randomToken(12), conferenceSolutionKey: { type: "hangoutsMeet" } } } }
      : {}),
  };
}

function conferenceUrl(ev: GEvent): string | undefined {
  return ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
}

export const google: CalendarProvider = {
  async listCalendars(conn) {
    const { data } = await providerFetch<{ items: GCalendar[] }>(conn, `${API}/users/me/calendarList?minAccessRole=reader`);
    return (data.items ?? []).map<CalendarInfo>((c) => ({
      id: c.id,
      name: c.summary,
      primary: Boolean(c.primary),
      canWrite: c.accessRole === "owner" || c.accessRole === "writer",
    }));
  },

  async accountInfo(conn) {
    const { data } = await providerFetch<{ sub?: string; email?: string }>(conn, "https://openidconnect.googleapis.com/v1/userinfo");
    return { id: data.sub, email: data.email };
  },

  async freeBusy(conn, calendarIds, window) {
    const { data } = await providerFetch<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>(
      conn,
      `${API}/freeBusy`,
      {
        method: "POST",
        json: {
          timeMin: new Date(window.start).toISOString(),
          timeMax: new Date(window.end).toISOString(),
          items: calendarIds.map((id) => ({ id })),
        },
      },
    );
    const out: Interval[] = [];
    for (const cal of Object.values(data.calendars ?? {})) {
      for (const b of cal.busy ?? []) out.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
    }
    return out;
  },

  async sync(conn, window, ownEventIds) {
    const calendarIds = conn.busyCalendarIds.length ? conn.busyCalendarIds : [conn.writeCalendarId ?? "primary"];
    const result: SyncResult = { upserts: [], deletions: [], cursor: { ...conn.syncCursor }, changedOwnEvents: [], full: false };
    for (const calendarId of calendarIds) {
      const cursorKey = `g:${calendarId}`;
      let pageToken: string | undefined;
      let syncToken: string | undefined = conn.syncCursor[cursorKey];
      let full = !syncToken;
      for (;;) {
        const params = new URLSearchParams({ singleEvents: "true", maxResults: "250", showDeleted: "true" });
        if (syncToken) params.set("syncToken", syncToken);
        else {
          params.set("timeMin", new Date(window.start).toISOString());
          params.set("timeMax", new Date(window.end).toISOString());
        }
        if (pageToken) params.set("pageToken", pageToken);
        let res;
        try {
          res = await providerFetch<{ items: GEvent[]; nextPageToken?: string; nextSyncToken?: string }>(
            conn,
            `${API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
          );
        } catch (e) {
          // 410 Gone: the sync token expired, restart with a full sync.
          if (e instanceof Error && /API 410/.test(e.message) && syncToken) {
            syncToken = undefined;
            full = true;
            pageToken = undefined;
            continue;
          }
          throw e;
        }
        for (const ev of res.data.items ?? []) {
          const ext = `${calendarId}:${ev.id}`;
          const cancelled = ev.status === "cancelled";
          if (ownEventIds.has(ev.id)) {
            const s = ev.start?.dateTime ? new Date(ev.start.dateTime) : undefined;
            const en = ev.end?.dateTime ? new Date(ev.end.dateTime) : undefined;
            result.changedOwnEvents.push({ externalEventId: ev.id, deleted: cancelled, start: s, end: en });
            continue; // our own events are represented by bookings already
          }
          if (cancelled || ev.transparency === "transparent") {
            result.deletions.push(ext);
            continue;
          }
          const s = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : undefined);
          const en = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : undefined);
          if (!s || !en) continue;
          result.upserts.push({ externalId: ext, start: new Date(s), end: new Date(en) });
        }
        if (res.data.nextPageToken) {
          pageToken = res.data.nextPageToken;
          continue;
        }
        if (res.data.nextSyncToken) result.cursor[cursorKey] = res.data.nextSyncToken;
        break;
      }
      result.full = result.full || full;
    }
    return result;
  },

  async createEvent(conn, calendarId, input) {
    const params = new URLSearchParams({ sendUpdates: "all", conferenceDataVersion: "1" });
    const { data } = await providerFetch<GEvent>(conn, `${API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
      method: "POST",
      json: toEventBody(input),
    });
    return { externalEventId: data.id, externalCalendarId: calendarId, conferenceUrl: conferenceUrl(data) };
  },

  async updateEvent(conn, calendarId, eventId, input) {
    const params = new URLSearchParams({ sendUpdates: "all", conferenceDataVersion: "1" });
    const body = toEventBody(input);
    delete (body as { conferenceData?: unknown }).conferenceData;
    const { data } = await providerFetch<GEvent>(
      conn,
      `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${params}`,
      { method: "PATCH", json: body },
    );
    return { externalEventId: data.id, externalCalendarId: calendarId, conferenceUrl: conferenceUrl(data) } satisfies WrittenEvent;
  },

  async deleteEvent(conn, calendarId, eventId) {
    const params = new URLSearchParams({ sendUpdates: "all" });
    try {
      await providerFetch(conn, `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${params}`, {
        method: "DELETE",
      });
    } catch (e) {
      if (e instanceof Error && /API (404|410)/.test(e.message)) return;
      throw e;
    }
  },

  async watch(conn, calendarId) {
    const secret = env().WEBHOOK_SECRET;
    if (!secret) return null;
    const channelId = randomToken(16);
    const { data } = await providerFetch<{ resourceId: string; expiration?: string }>(
      conn,
      `${API}/calendars/${encodeURIComponent(calendarId)}/events/watch`,
      {
        method: "POST",
        json: { id: channelId, type: "web_hook", address: appUrl("/api/calendar/google/webhook"), token: secret },
      },
    );
    return {
      channelId,
      resourceId: data.resourceId,
      expiresAt: data.expiration ? new Date(Number(data.expiration)) : new Date(Date.now() + 6 * 86_400_000),
    };
  },

  async unwatch(conn) {
    if (!conn.watchChannelId || !conn.watchResourceId) return;
    await providerFetch(conn, `${API}/channels/stop`, {
      method: "POST",
      json: { id: conn.watchChannelId, resourceId: conn.watchResourceId },
    }).catch(() => undefined);
  },
};
