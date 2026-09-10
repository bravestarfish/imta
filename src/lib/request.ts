import type { NextRequest } from "next/server";
import { headers } from "next/headers";

export function clientIp(req?: NextRequest): string {
  const h = req?.headers;
  const fwd = h?.get("x-forwarded-for") ?? h?.get("x-real-ip");
  return (fwd?.split(",")[0]?.trim() || "unknown").slice(0, 64);
}

export async function clientIpFromHeaders(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for") ?? h.get("x-real-ip");
  return (fwd?.split(",")[0]?.trim() || "unknown").slice(0, 64);
}
