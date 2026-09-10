import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserByHandle, displayName } from "@/lib/users/service";
import { publicEventTypesOf } from "@/lib/event-types/service";
import { Avatar } from "@/components/ui";

export default async function PublicProfile({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const user = await getUserByHandle(decodeURIComponent(handle).replace(/^@/, ""));
  if (!user || !user.publicProfile) notFound();
  const eventTypes = await publicEventTypesOf("user", user.did);
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center gap-4">
        <Avatar user={user} size={64} />
        <div>
          <h1 className="text-2xl font-semibold">{displayName(user)}</h1>
          <p className="text-sm text-muted">@{user.handle} · {user.timezone}</p>
        </div>
      </div>
      {user.bio ? <p className="mt-4 text-sm">{user.bio}</p> : null}
      <h2 className="mt-8 mb-3 font-medium">Book a time</h2>
      {!eventTypes.length ? <p className="text-sm text-muted">No public event types right now.</p> : null}
      <ul className="space-y-2">
        {eventTypes.map((e) => (
          <li key={e.id}>
            <Link href={`/@${user.handle}/${e.slug}`} className="card block hover:border-accent" style={{ borderLeftColor: e.color, borderLeftWidth: 4 }}>
              <div className="font-medium">{e.title}</div>
              <div className="text-xs text-muted">{e.durationMinutes} min{e.capacity > 1 ? ` · ${e.capacity} seats` : ""}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
