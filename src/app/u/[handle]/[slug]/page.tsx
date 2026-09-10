import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveBookable } from "@/lib/event-types/service";
import { BookingPage } from "@/components/booking/page";

export default async function PersonalBooking({ params, searchParams }: { params: Promise<{ handle: string; slug: string }>; searchParams: Promise<{ k?: string }> }) {
  const { handle, slug } = await params;
  const { k } = await searchParams;
  const viewer = await getCurrentUser();
  const clean = decodeURIComponent(handle).replace(/^@/, "");
  const res = await resolveBookable({ handle: clean }, slug, viewer, k ?? null);
  if (!res) notFound();
  return <BookingPage {...res} currentPath={`/@${clean}/${slug}${k ? `?k=${k}` : ""}`} linkKey={k ?? null} />;
}
