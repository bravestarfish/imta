"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { eventTypeInput, createEventType, updateEventType, deleteEventType, duplicateEventType } from "@/lib/event-types/service";
import { inviteToEventType, revokeInvitation, respondInvitation } from "@/lib/event-types/invitations";

export async function saveEventTypeAction(id: string | null, ownerKind: "user" | "team", ownerId: string, input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = eventTypeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  try {
    const et = id ? await updateEventType(user, id, parsed.data) : await createEventType(user, ownerKind, ownerId, parsed.data);
    revalidatePath("/event-types");
    revalidatePath(`/event-types/${et.id}`);
    return { ok: true, id: et.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save" };
  }
}

export async function deleteEventTypeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await deleteEventType(user, String(formData.get("id") ?? ""));
  revalidatePath("/event-types");
  redirect("/event-types");
}

export async function duplicateEventTypeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const et = await duplicateEventType(user, String(formData.get("id") ?? ""));
  redirect(`/event-types/${et.id}`);
}

export async function inviteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("eventTypeId") ?? "");
  const res = await inviteToEventType(user, id, String(formData.get("handle") ?? ""), String(formData.get("message") ?? "") || undefined);
  revalidatePath(`/event-types/${id}`);
  if (!res.ok) redirect(`/event-types/${id}?tab=invitations&error=${encodeURIComponent(res.error)}`);
  redirect(`/event-types/${id}?tab=invitations`);
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("eventTypeId") ?? "");
  await revokeInvitation(user, String(formData.get("invitationId") ?? ""));
  revalidatePath(`/event-types/${id}`);
  redirect(`/event-types/${id}?tab=invitations`);
}

export async function respondInvitationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const status = formData.get("status") === "accepted" ? "accepted" : "declined";
  await respondInvitation(user.did, String(formData.get("invitationId") ?? ""), status);
  revalidatePath("/invitations");
}
