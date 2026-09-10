/**
 * Generates a private JWK for the ATProto OAuth confidential client.
 * Usage: pnpm keygen  -> paste the output into ATPROTO_PRIVATE_KEY_1
 */
import { JoseKey } from "@atproto/oauth-client-node";

async function main() {
  const kid = `imta-${Date.now().toString(36)}`;
  const key = await JoseKey.generate(["ES256"], kid);
  console.log(JSON.stringify(key.privateJwk));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
