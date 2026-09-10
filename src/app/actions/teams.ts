"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createTeam, updateTeam, deleteTeam, inviteToTeam, respondTeamInvite, setMemberRole, removeMember } from "@/lib/teams/service";
import type { TeamRole } from "@/db/schema";

export async function createTeamAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/teams?error=Name+required");
  const team = await createTeam(user, name.slice(0, 80), String(formData.get("timezone") ?? user.timezone), String(formData.get("description") ?? "") || undefined);
  redirect(`/teams/${team.slug}`);
}

export async function updateTeamAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const teamId = String(formData.get("teamId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await updateTeam(user, teamId, { name: String(formData.get("name") ?? "").trim().slice(0, 80), timezone: String(formData.get("timezone") ?? "UTC"), description: String(formData.get("description") ?? "") || undefined });
  revalidatePath(`/teams/${slug}`);
  redirect(`/teams/${slug}?saved=1`);
}

export async function deleteTeamAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await deleteTeam(user, String(formData.get("teamId") ?? ""));
  redirect("/teams");
}

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const teamId = String(formData.get("teamId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const res = await inviteToTeam(user, teamId, String(formData.get("handle") ?? ""), (String(formData.get("role") ?? "member") as TeamRole) || "member");
  revalidatePath(`/teams/${slug}`);
  redirect(res.ok ? `/teams/${slug}?invited=1` : `/teams/${slug}?error=${encodeURIComponent(res.error)}`);
}

export async function respondTeamInviteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await respondTeamInvite(user.did, String(formData.get("inviteId") ?? ""), formData.get("accept") === "1");
  revalidatePath("/teams");
  redirect("/teams");
}

export async function setRoleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  await setMemberRole(user, String(formData.get("teamId") ?? ""), String(formData.get("did") ?? ""), String(formData.get("role") ?? "member") as TeamRole);
  revalidatePath(`/teams/${slug}`);
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const did = String(formData.get("did") ?? "");
  await removeMember(user, String(formData.get("teamId") ?? ""), did);
  revalidatePath(`/teams/${slug}`);
  if (did === user.did) redirect("/teams");
}
