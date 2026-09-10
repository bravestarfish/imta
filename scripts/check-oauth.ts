/** Diagnostic: builds the production OAuth client and prints its metadata. Usage: APP_URL=https://imta.rsvp pnpm tsx scripts/check-oauth.ts */
import { getOAuthClient } from "@/lib/atproto/client";

async function main() {
  const client = await getOAuthClient();
  console.log("client ok");
  console.log(JSON.stringify(client.clientMetadata, null, 1).slice(0, 800));
  console.log("jwks keys:", client.jwks.keys.length);
  const handle = process.argv[2];
  if (handle) {
    const url = await client.authorize(handle, { state: "x" });
    console.log("authorize ->", url.toString().slice(0, 120));
  }
}
main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
