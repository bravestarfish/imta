import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { appUrl } from "@/lib/env";

export async function POST() {
  await destroySession();
  return NextResponse.redirect(appUrl("/"), 303);
}
