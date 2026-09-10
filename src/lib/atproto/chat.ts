import { agentFor } from "./agent";
import { log, errMessage } from "@/lib/log";

const CHAT_SERVICE_DID = "did:web:api.bsky.chat";

export type DmResult = { ok: true } | { ok: false; reason: string };

/**
 * Send a Bluesky direct message from `senderDid` to `recipientDid`. Requires
 * the sender to have granted the `transition:chat.bsky` scope. Fails softly:
 * the recipient may not accept DMs from non-followers.
 */
export async function sendDirectMessage(
  senderDid: string,
  recipientDid: string,
  text: string,
): Promise<DmResult> {
  const agent = await agentFor(senderDid);
  if (!agent) return { ok: false, reason: "sender session unavailable" };
  try {
    const chat = agent.withProxy("bsky_chat", CHAT_SERVICE_DID);
    const convo = await chat.chat.bsky.convo.getConvoForMembers({ members: [recipientDid] });
    await chat.chat.bsky.convo.sendMessage({
      convoId: convo.data.convo.id,
      message: { text },
    });
    return { ok: true };
  } catch (e) {
    const reason = errMessage(e);
    log.warn("bsky dm failed", { senderDid, recipientDid, reason });
    return { ok: false, reason };
  }
}
