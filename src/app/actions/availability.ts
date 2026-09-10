"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createSchedule, saveSchedule, deleteSchedule } from "@/lib/availability/service";

const payload = z.object({
  name: z.string().trim().min(1).max(60),
  timezone: z.string().min(1).max(64),
  isDefault: z.boolean().optional(),
  rules: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMinutes: z.number().int().min(0).max(1440), endMinutes: z.number().int().min(0).max(1440) })),
  overrides: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startMinutes: z.number().int().nullable().optional(), endMinutes: z.number().int().nullable().optional(), unavailable: z.boolean().optional() })),
});

export async function saveScheduleAction(id: string, input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = payload.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const err = await saveSchedule(user.did, id, parsed.data);
  if (err) return { ok: false, error: err };
  revalidatePath("/availability");
  return { ok: true };
}

export async function createScheduleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "New schedule").trim() || "New schedule";
  const id = await createSchedule(user.did, name, user.timezone);
  redirect(`/availability/${id}`);
}

export async function deleteScheduleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await deleteSchedule(user.did, String(formData.get("id") ?? ""));
  revalidatePath("/availability");
  redirect("/availability");
}

const painted = z.object({
  scheduleId: z.string(),
  days: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), cells: z.array(z.number().int().min(0).max(47)) })).max(31),
});

export async function savePaintedDaysAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = painted.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { savePaintedDays } = await import("@/lib/availability/service");
  const err = await savePaintedDays(user.did, parsed.data.scheduleId, parsed.data.days);
  if (err) return { ok: false, error: err };
  revalidatePath("/availability");
  revalidatePath(`/availability/${parsed.data.scheduleId}`);
  return { ok: true };
}

const eventPaint = z.object({
  eventTypeId: z.string(),
  days: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), cells: z.array(z.number().int().min(0).max(47)) })).max(31),
});

export async function saveEventPaintAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = eventPaint.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { saveEventPaint, hostPaintZone } = await import("@/lib/availability/service");
  const err = await saveEventPaint(parsed.data.eventTypeId, user.did, await hostPaintZone(user.did), parsed.data.days);
  if (err) return { ok: false, error: err };
  revalidatePath(`/event-types/${parsed.data.eventTypeId}`);
  return { ok: true };
}

export async function setEventAvailabilityModeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const eventTypeId = String(formData.get("eventTypeId") ?? "");
  const mode = formData.get("mode") === "painted" ? "painted" : "schedule";
  const { setHostAvailabilityMode } = await import("@/lib/availability/service");
  await setHostAvailabilityMode(eventTypeId, user.did, mode);
  revalidatePath(`/event-types/${eventTypeId}`);
  const week = String(formData.get("week") ?? "");
  redirect(`/event-types/${eventTypeId}?tab=availability${/^\d{4}-\d{2}-\d{2}$/.test(week) ? `&week=${week}` : ""}`);
}

export async function clearEventPaintAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const eventTypeId = String(formData.get("eventTypeId") ?? "");
  const { clearEventPaint } = await import("@/lib/availability/service");
  await clearEventPaint(eventTypeId, user.did);
  revalidatePath(`/event-types/${eventTypeId}`);
  redirect(`/event-types/${eventTypeId}?tab=availability`);
}
