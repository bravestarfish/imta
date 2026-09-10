"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { enqueue } from "@/lib/jobs/queue";
import { resolveIdentity } from "@/lib/atproto/identity";
import { exportUserData, deleteUserAccount } from "@/lib/gdpr/service";
import { destroySession } from "@/lib/auth/session";
import { removeConnection } from "@/lib/calendar/service";

const profileSchema = z.object({
  email: z.string().trim().email().max(200),
  timezone: z.string().min(1).max(64),
  displayName: z.string().trim().max(64).optional(),
  bio: z.string().trim().max(500).optional(),
  publicProfile: z.boolean(),
  notifyEmail: z.boolean(),
  notifyDm: z.boolean(),
});

export async function saveProfile(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse({
    email: formData.get("email"),
    timezone: formData.get("timezone"),
    displayName: formData.get("displayName") || undefined,
    bio: formData.get("bio") || undefined,
    publicProfile: formData.get("publicProfile") === "on",
    notifyEmail: formData.get("notifyEmail") === "on",
    notifyDm: formData.get("notifyDm") === "on",
  });
  if (!parsed.success) redirect(`/settings?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input")}`);
  const d = parsed.data;
  const emailChanged = d.email !== user.email;
  await db
    .update(schema.users)
    .set({
      email: d.email,
      emailVerifiedAt: emailChanged ? null : user.emailVerifiedAt,
      timezone: d.timezone,
      displayName: d.displayName ?? user.displayName,
      bio: d.bio ?? null,
      publicProfile: d.publicProfile,
      notifyEmail: d.notifyEmail,
      notifyDm: d.notifyDm,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.did, user.did));
  // The default schedule follows the profile timezone until edited separately.
  await enqueue("atproto.publish", { kind: "profile", id: user.did });
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function completeOnboarding(formData: FormData): Promise<void> {
  const user = await requireUser();
  const email = String(formData.get("email") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "UTC");
  const next = String(formData.get("next") ?? "/dashboard");
  if (!z.string().email().safeParse(email).success) redirect("/onboarding?error=email");
  await db.update(schema.users).set({ email, timezone, onboardedAt: new Date(), updatedAt: new Date() }).where(eq(schema.users.did, user.did));
  const def = await db.query.availabilitySchedules.findFirst({ where: (s, { and, eq: e }) => and(e(s.userDid, user.did), e(s.isDefault, true)) });
  if (def && def.timezone === "UTC") await db.update(schema.availabilitySchedules).set({ timezone }).where(eq(schema.availabilitySchedules.id, def.id));
  redirect(next.startsWith("/") ? next : "/dashboard");
}

export async function addBlock(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = await resolveIdentity(String(formData.get("handle") ?? ""));
  if (!id) redirect("/settings?error=Could+not+resolve+that+handle");
  await db.insert(schema.blocks).values({ userDid: user.did, blockedDid: id.did }).onConflictDoNothing();
  revalidatePath("/settings");
}

export async function removeBlock(formData: FormData): Promise<void> {
  const user = await requireUser();
  const did = String(formData.get("did") ?? "");
  await db.delete(schema.blocks).where(and(eq(schema.blocks.userDid, user.did), eq(schema.blocks.blockedDid, did)));
  revalidatePath("/settings");
}

export async function disconnectProvider(formData: FormData): Promise<void> {
  const user = await requireUser();
  await removeConnection(user.did, String(formData.get("id") ?? ""));
  revalidatePath("/settings");
  revalidatePath("/calendars");
}

export async function exportMyData(): Promise<string> {
  const user = await requireUser();
  return JSON.stringify(await exportUserData(user), null, 2);
}

export async function deleteMyAccount(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (String(formData.get("confirm") ?? "") !== user.handle) redirect("/settings?error=Type+your+handle+to+confirm");
  await deleteUserAccount(user);
  await destroySession();
  redirect("/?deleted=1");
}
