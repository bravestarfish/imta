import { getOAuthClient } from "@/lib/atproto/client";

export async function GET() {
  const client = await getOAuthClient();
  return Response.json(client.jwks, {
    headers: { "cache-control": "public, max-age=300" },
  });
}
