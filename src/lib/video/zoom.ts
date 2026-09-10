import { providerFetch } from "@/lib/calendar/oauth";
import type { ProviderConnection } from "@/db/schema";

const API = "https://api.zoom.us/v2";

export async function zoomAccountInfo(conn: ProviderConnection): Promise<{ id?: string; email?: string }> {
  const { data } = await providerFetch<{ id?: string; email?: string }>(conn, `${API}/users/me`);
  return data;
}

export async function createZoomMeeting(
  conn: ProviderConnection,
  input: { topic: string; start: Date; durationMinutes: number; timezone: string; agenda?: string },
): Promise<{ id: string; joinUrl: string }> {
  const { data } = await providerFetch<{ id: number; join_url: string }>(conn, `${API}/users/me/meetings`, {
    method: "POST",
    json: {
      topic: input.topic.slice(0, 200),
      type: 2,
      start_time: input.start.toISOString(),
      duration: input.durationMinutes,
      timezone: input.timezone,
      agenda: input.agenda?.slice(0, 2000),
      settings: { join_before_host: true, waiting_room: false, approval_type: 2 },
    },
  });
  return { id: String(data.id), joinUrl: data.join_url };
}

export async function updateZoomMeeting(conn: ProviderConnection, id: string, input: { start: Date; durationMinutes: number; timezone: string }) {
  await providerFetch(conn, `${API}/meetings/${id}`, {
    method: "PATCH",
    json: { start_time: input.start.toISOString(), duration: input.durationMinutes, timezone: input.timezone },
  });
}

export async function deleteZoomMeeting(conn: ProviderConnection, id: string) {
  await providerFetch(conn, `${API}/meetings/${id}`, { method: "DELETE" }).catch(() => undefined);
}
