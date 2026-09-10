import type { NextRequest } from "next/server";
import { startConnect } from "@/lib/calendar/connect-flow";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  return startConnect(provider);
}
