import { env } from "@/lib/env";
import { randomToken } from "@/lib/crypto";
import { connectionOfProvider, writeTargetFor } from "@/lib/calendar/service";
import { createZoomMeeting } from "./zoom";
import type { VideoProvider } from "@/db/schema";

export type ResolvedVideo = { provider: Exclude<VideoProvider, "auto">; url?: string; /** ask the calendar provider to create the link when writing the host event */ viaCalendar?: boolean; zoomId?: string };

export function jitsiUrl(): string {
  return `${env().JITSI_BASE_URL.replace(/\/$/, "")}/imta-${randomToken(9)}`;
}

/**
 * Decide how to produce a video link for a meeting hosted by `hostDid`.
 *  - google_meet: created by Google Calendar when the host event is written
 *  - zoom: created through the host's Zoom connection
 *  - jitsi: generated locally (always works)
 */
export async function resolveVideo(
  hostDid: string,
  preference: VideoProvider,
  input: { topic: string; start: Date; durationMinutes: number; timezone: string },
): Promise<ResolvedVideo> {
  if (preference === "none") return { provider: "none" };
  const wantsMeet = preference === "google_meet" || preference === "auto";
  const wantsZoom = preference === "zoom" || preference === "auto";

  if (wantsMeet) {
    const target = await writeTargetFor(hostDid);
    if (target?.provider === "google") return { provider: "google_meet", viaCalendar: true };
    if (preference === "google_meet") return { provider: "jitsi", url: jitsiUrl() };
  }
  if (wantsZoom) {
    const zoom = await connectionOfProvider(hostDid, "zoom");
    if (zoom) {
      try {
        const m = await createZoomMeeting(zoom, input);
        return { provider: "zoom", url: m.joinUrl, zoomId: m.id };
      } catch {
        /* fall through to jitsi */
      }
    }
  }
  return { provider: "jitsi", url: jitsiUrl() };
}
