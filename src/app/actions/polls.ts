"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { requireUser } from "@/lib/auth/session";
import { createPoll, vote, closePoll, deletePoll } from "@/lib/polls/service";
import { resolveIdentity } from "@/lib/atproto/identity";
import { teamMembersWithUsers } from "@/lib/teams/service";

export async function createPollAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const teamId = String(formData.get("teamId") ?? "") || null;
  const timezone = String(formData.get("timezone") ?? user.timezone);
  const durationMinutes = Math.max(5, Number(formData.get("durationMinutes") ?? 60));
  if (!title) redirect(`/polls/new?error=Title+required${teamId ? `&team=${teamId}` : ""}`);
  const options = formData
    .getAll("option")
    .map(String)
    .filter(Boolean)
    .map((v) => DateTime.fromISO(v, { zone: timezone }))
    .filter((d) => d.isValid)
    .map((d) => ({ start: d.toJSDate(), end: d.plus({ minutes: durationMinutes }).toJSDate() }));
  if (!options.length) redirect(`/polls/new?error=Add+at+least+one+option${teamId ? `&team=${teamId}` : ""}`);
  const participants: string[] = [];
  if (teamId) participants.push(...(await teamMembersWithUsers(teamId)).map((m) => m.did));
  for (const h of String(formData.get("participants") ?? "").split(/[\s,]+/).filter(Boolean)) {
    const id = await resolveIdentity(h);
    if (id) participants.push(id.did);
  }
  const poll = await createPoll(user, { title, description: String(formData.get("description") ?? "") || undefined, teamId, durationMinutes, timezone, participantDids: participants, options });
  redirect(`/polls/${poll.id}`);
}

export async function voteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const pollId = String(formData.get("pollId") ?? "");
  const answers: Record<string, "yes" | "maybe" | "no"> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("opt:") && (v === "yes" || v === "maybe" || v === "no")) answers[k.slice(4)] = v;
  }
  await vote(user.did, pollId, answers);
  revalidatePath(`/polls/${pollId}`);
}

export async function closePollAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const pollId = String(formData.get("pollId") ?? "");
  await closePoll(user, pollId, String(formData.get("finalOptionId") ?? "") || null);
  revalidatePath(`/polls/${pollId}`);
}

export async function deletePollAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await deletePoll(user, String(formData.get("pollId") ?? ""));
  redirect("/polls");
}
