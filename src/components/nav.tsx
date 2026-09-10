import Link from "next/link";
import type { User } from "@/db/schema";
import { Avatar } from "./ui";

const links = [
  ["/dashboard", "Dashboard"],
  ["/event-types", "Event types"],
  ["/availability", "Availability"],
  ["/teams", "Teams"],
  ["/bookings", "Bookings"],
  ["/calendars", "Calendars"],
];

export function Nav({ user }: { user: User | null }) {
  return (
    <header className="border-b border-border bg-card/60 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href={user ? "/dashboard" : "/"} className="text-lg font-semibold tracking-tight">
          imta<span className="text-accent">.rsvp</span>
        </Link>
        {user ? (
          <>
            <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {links.map(([href, label]) => (
                <Link key={href} href={href} className="hover:text-foreground">
                  {label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <Link href="/invitations" className="text-sm text-muted hover:text-foreground">Invitations</Link>
              <Link href="/settings" className="flex items-center gap-2 text-sm">
                <Avatar user={user} size={28} />
                <span className="hidden sm:inline">@{user.handle}</span>
              </Link>
            </div>
          </>
        ) : (
          <div className="ml-auto">
            <Link href="/login" className="btn-primary">Sign in</Link>
          </div>
        )}
      </div>
    </header>
  );
}
