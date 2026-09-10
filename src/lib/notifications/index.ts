import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { sendMail, type Mail } from "@/lib/email/mailer";
import { sendDirectMessage } from "@/lib/atproto/chat";
import { log } from "@/lib/log";

/** Send an email and log the outcome. */
export async function notifyEmail(kind: string, subjectRef: string | null, mail: Mail, recipientDid?: string | null) {
  const res = await sendMail(mail);
  await db.insert(schema.notificationLog).values({
    id: newId("ntf"),
    recipientDid: recipientDid ?? null,
    recipientEmail: mail.to.email,
    channel: "email",
    kind,
    subjectRef,
    status: res.ok ? "sent" : res.error === "email disabled" ? "skipped" : "failed",
    error: res.ok ? null : res.error ?? null,
  });
  return res;
}

/** Send a Bluesky DM from one user to another, respecting the recipient's preferences. */
export async function notifyDm(kind: string, subjectRef: string | null, senderDid: string, recipientDid: string, text: string) {
  const recipient = await db.query.users.findFirst({ where: eq(schema.users.did, recipientDid), columns: { notifyDm: true } });
  if (recipient && !recipient.notifyDm) {
    await db.insert(schema.notificationLog).values({ id: newId("ntf"), recipientDid, channel: "bsky_dm", kind, subjectRef, status: "skipped", error: "recipient opted out" });
    return { ok: false as const, reason: "opted out" };
  }
  const res = await sendDirectMessage(senderDid, recipientDid, text);
  await db.insert(schema.notificationLog).values({
    id: newId("ntf"),
    recipientDid,
    channel: "bsky_dm",
    kind,
    subjectRef,
    status: res.ok ? "sent" : "failed",
    error: res.ok ? null : res.reason,
  });
  if (!res.ok) log.info("dm not delivered", { kind, recipientDid, reason: res.reason });
  return res;
}
