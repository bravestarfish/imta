import type { NextRequest } from "next/server";
import { finishConnect } from "@/lib/calendar/connect-flow";

export async function GET(req: NextRequest) {
  return finishConnect(req, "zoom");
}
