import type { NextRequest } from "next/server";
import { finishConnect } from "@/lib/calendar/connect-flow";

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  return finishConnect(req, provider);
}
