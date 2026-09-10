import { Agent } from "@atproto/api";
import { getOAuthClient } from "./client";
import { log, errMessage } from "@/lib/log";

/** Restore an authenticated Agent for a DID (refreshes tokens if needed). */
export async function agentFor(did: string): Promise<Agent | null> {
  try {
    const client = await getOAuthClient();
    const session = await client.restore(did);
    return new Agent(session);
  } catch (e) {
    log.warn("atproto: could not restore session", { did, error: errMessage(e) });
    return null;
  }
}

/** Unauthenticated agent against the public Bluesky AppView (profile lookups). */
export function publicAgent(): Agent {
  return new Agent("https://public.api.bsky.app");
}
