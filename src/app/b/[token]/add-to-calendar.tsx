export function AddToCalendar({ token }: { token: string }) {
  return (
    <p className="text-xs text-muted">
      <a className="underline" href={`/b/${token}/invite.ics`}>Download .ics</a> to add this to any calendar.
    </p>
  );
}
