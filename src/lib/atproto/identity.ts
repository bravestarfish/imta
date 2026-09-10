import { IdResolver } from "@atproto/identity";
import { isValidHandle } from "@atproto/syntax";
import { publicAgent } from "./agent";

const resolver = new IdResolver();

export type Identity = { did: string; handle: string; pds?: string };

/** Resolve a handle or DID to a DID (+ handle when known). */
export async function resolveIdentity(input: string): Promise<Identity | null> {
  const value = input.trim().replace(/^@/, "");
  if (!value) return null;
  if (value.startsWith("did:")) {
    const doc = await resolver.did.resolve(value).catch(() => null);
    if (!doc) return null;
    const handle = doc.alsoKnownAs?.find((a) => a.startsWith("at://"))?.slice(5) ?? value;
    const pds = doc.service?.find((s) => s.id === "#atproto_pds")?.serviceEndpoint;
    return { did: value, handle, pds: typeof pds === "string" ? pds : undefined };
  }
  if (!isValidHandle(value)) return null;
  const did = await resolver.handle.resolve(value).catch(() => undefined);
  if (!did) return null;
  return { did, handle: value };
}

export type PublicProfile = {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  description?: string;
};

export async function fetchPublicProfile(actor: string): Promise<PublicProfile | null> {
  try {
    const res = await publicAgent().getProfile({ actor });
    return {
      did: res.data.did,
      handle: res.data.handle,
      displayName: res.data.displayName,
      avatar: res.data.avatar,
      description: res.data.description,
    };
  } catch {
    return null;
  }
}

export async function fetchPublicProfiles(actors: string[]): Promise<Map<string, PublicProfile>> {
  const out = new Map<string, PublicProfile>();
  const unique = [...new Set(actors)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 25) {
    const chunk = unique.slice(i, i + 25);
    try {
      const res = await publicAgent().getProfiles({ actors: chunk });
      for (const p of res.data.profiles) {
        out.set(p.did, {
          did: p.did,
          handle: p.handle,
          displayName: p.displayName,
          avatar: p.avatar,
          description: p.description,
        });
      }
    } catch {
      /* best effort */
    }
  }
  return out;
}
