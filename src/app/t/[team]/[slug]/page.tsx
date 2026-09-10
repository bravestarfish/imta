import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveBookable } from "@/lib/event-types/service";
import { BookingPage } from "@/components/booking/page";

export default async function TeamBooking({ params, searchParams }: { params: Promise<{ team: string; slug: string }>; searchParams: Promise<{ k?: string }> }) {
  const { team, slug } = await params;
  const { k } = await searchParams;
  const viewer = await getCurrentUser();
  const res = await resolveBookable({ teamSlug: team }, slug, viewer, k ?? null);
  if (!res) notFound();
  return <BookingPage {...res} currentPath={`/t/${team}/${slug}${k ? `?k=${k}` : ""}`} linkKey={k ?? null} />;
}
