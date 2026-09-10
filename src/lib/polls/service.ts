import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Poll, PollOption, PollVote, User } from "@/db/schema";
import { newId } from "@/lib/ids";
import { teamRole } from "@/lib/teams/service";

/**
 * Organizer polls: a lightweight "find a time" among organizers (team members
 * or a hand-picked set of users) that complements the computed overlap view.
 */
export async function createPoll(
  actor: User,
  input: { title: string; description?: string; teamId?: string | null; durationMinutes: number; timezone: string; participantDids: string[]; options: { start: Date; end: Date }[] },
): Promise<Poll> {
  if (input.teamId && !(await teamRole(input.teamId, actor.did))) throw new Error("Forbidden");
  const id = newId("poll");
  const participants = [...new Set([actor.did, ...input.participantDids])];
  const [poll] = await db
    .insert(schema.polls)
    .values({
      id,
      teamId: input.teamId ?? null,
      createdBy: actor.did,
      title: input.title,
      description: input.description ?? null,
      durationMinutes: input.durationMinutes,
      timezone: input.timezone,
      participantDids: participants,
    })
    .returning();
  if (input.options.length) {
    await db.insert(schema.pollOptions).values(input.options.map((o) => ({ id: newId("opt"), pollId: id, startAt: o.start, endAt: o.end })));
  }
  return poll;
}

export type PollView = { poll: Poll; options: PollOption[]; votes: PollVote[] };

export async function getPoll(pollId: string, viewerDid: string): Promise<PollView | null> {
  const poll = await db.query.polls.findFirst({ where: eq(schema.polls.id, pollId) });
  if (!poll) return null;
  const allowed = poll.participantDids.includes(viewerDid) || (poll.teamId ? Boolean(await teamRole(poll.teamId, viewerDid)) : false);
  if (!allowed) return null;
  const options = await db.query.pollOptions.findMany({ where: eq(schema.pollOptions.pollId, pollId), orderBy: (o, { asc }) => asc(o.startAt) });
  const votes = options.length ? await db.query.pollVotes.findMany({ where: inArray(schema.pollVotes.optionId, options.map((o) => o.id)) }) : [];
  return { poll, options, votes };
}

export async function vote(userDid: string, pollId: string, answers: Record<string, "yes" | "maybe" | "no">): Promise<void> {
  const view = await getPoll(pollId, userDid);
  if (!view || view.poll.status !== "open") throw new Error("Poll not open");
  const ids = new Set(view.options.map((o) => o.id));
  for (const [optionId, answer] of Object.entries(answers)) {
    if (!ids.has(optionId)) continue;
    await db
      .insert(schema.pollVotes)
      .values({ optionId, userDid, answer, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [schema.pollVotes.optionId, schema.pollVotes.userDid], set: { answer, updatedAt: new Date() } });
  }
}

export async function closePoll(actor: User, pollId: string, finalOptionId: string | null): Promise<void> {
  const poll = await db.query.polls.findFirst({ where: eq(schema.polls.id, pollId) });
  if (!poll || poll.createdBy !== actor.did) throw new Error("Forbidden");
  await db.update(schema.polls).set({ status: "closed", finalOptionId }).where(eq(schema.polls.id, pollId));
}

export async function deletePoll(actor: User, pollId: string): Promise<void> {
  await db.delete(schema.polls).where(and(eq(schema.polls.id, pollId), eq(schema.polls.createdBy, actor.did)));
}

export async function myPolls(userDid: string): Promise<Poll[]> {
  const memberships = await db.query.teamMembers.findMany({ where: eq(schema.teamMembers.userDid, userDid), columns: { teamId: true } });
  const all = await db.query.polls.findMany({ orderBy: (p, { desc }) => desc(p.createdAt) });
  const teamIds = new Set(memberships.map((m) => m.teamId));
  return all.filter((p) => p.participantDids.includes(userDid) || (p.teamId && teamIds.has(p.teamId)));
}
