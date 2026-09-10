import { google } from "./google";
import { microsoft } from "./microsoft";
import type { CalendarProvider } from "./types";
import type { ProviderKind } from "@/db/schema";

export function calendarProvider(kind: ProviderKind): CalendarProvider {
  switch (kind) {
    case "google":
      return google;
    case "microsoft":
      return microsoft;
    default:
      throw new Error(`${kind} is not a calendar provider`);
  }
}

export const CALENDAR_PROVIDERS: ProviderKind[] = ["google", "microsoft"];
export * from "./types";
