import { startConnect } from "@/lib/calendar/connect-flow";

export async function GET() {
  return startConnect("zoom");
}
