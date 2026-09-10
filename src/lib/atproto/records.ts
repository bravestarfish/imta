import { AtUri } from "@atproto/syntax";
import { agentFor } from "./agent";
import { NSID, assertValid, type ProfileRecord, type EventTypeRecord, type CalendarEventRecord } from "./lexicons";
import { log, errMessage } from "@/lib/log";

/**
 * Helpers for writing public records into a user's own repository (PDS).
 * Only public data is ever written here: booking profiles, public event
 * types and public group sessions. Everything private stays in our database.
 */

async function putRecord(did: string, collection: string, rkey: string, record: Record<string, unknown>): Promise<string | null> {
  const agent = await agentFor(did);
  if (!agent) return null;
  try {
    assertValid(collection, record);
    const res = await agent.com.atproto.repo.putRecord({ repo: did, collection, rkey, record });
    return res.data.uri;
  } catch (e) {
    log.warn("atproto putRecord failed", { did, collection, error: errMessage(e) });
    return null;
  }
}

async function createRecord(did: string, collection: string, record: Record<string, unknown>): Promise<string | null> {
  const agent = await agentFor(did);
  if (!agent) return null;
  try {
    assertValid(collection, record);
    const res = await agent.com.atproto.repo.createRecord({ repo: did, collection, record });
    return res.data.uri;
  } catch (e) {
    log.warn("atproto createRecord failed", { did, collection, error: errMessage(e) });
    return null;
  }
}

export async function deleteRecordByUri(did: string, uri: string): Promise<boolean> {
  const agent = await agentFor(did);
  if (!agent) return false;
  try {
    const at = new AtUri(uri);
    await agent.com.atproto.repo.deleteRecord({ repo: did, collection: at.collection, rkey: at.rkey });
    return true;
  } catch (e) {
    log.warn("atproto deleteRecord failed", { did, uri, error: errMessage(e) });
    return false;
  }
}

export async function upsertRecordByUri(did: string, uri: string | null, collection: string, record: Record<string, unknown>) {
  if (uri) {
    const at = new AtUri(uri);
    return putRecord(did, collection, at.rkey, record);
  }
  return createRecord(did, collection, record);
}

export function publishProfile(did: string, record: Omit<ProfileRecord, "$type">) {
  return putRecord(did, NSID.profile, "self", { $type: NSID.profile, ...record });
}

export function unpublishProfile(did: string) {
  return deleteRecordByUri(did, `at://${did}/${NSID.profile}/self`);
}

export function publishEventType(did: string, existingUri: string | null, record: Omit<EventTypeRecord, "$type">) {
  return upsertRecordByUri(did, existingUri, NSID.eventType, { $type: NSID.eventType, ...record });
}

export function publishCalendarEvent(did: string, existingUri: string | null, record: Omit<CalendarEventRecord, "$type">) {
  return upsertRecordByUri(did, existingUri, NSID.calendarEvent, { $type: NSID.calendarEvent, ...record });
}
