export const metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <article className="prose prose-sm max-w-2xl dark:prose-invert">
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <p className="mt-4 text-sm text-muted">This page summarises how imta handles personal data. Replace it with your organisation&apos;s full policy before going live.</p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">
        <li><strong>Identity.</strong> You sign in with your Atmosphere account. We store your DID, username, display name and avatar URL.</li>
        <li><strong>Email.</strong> Used only to send confirmations, calendar invitations and reminders. Never published or shared.</li>
        <li><strong>Calendars.</strong> With your consent we read free/busy times from Google Calendar or Microsoft 365. We store start and end times of busy blocks, never titles, attendees or content. Tokens are encrypted at rest. You can disconnect at any time, which deletes the cached busy times.</li>
        <li><strong>Bookings and invitations.</strong> Stored in our database in the EU and visible only to the people involved.</li>
        <li><strong>Your Atmosphere repository.</strong> Only if you opt in: a public booking profile, public event types, and public group sessions are written to your own account. You can remove them here or in any ATProto client.</li>
        <li><strong>Your rights.</strong> Export or delete your data from Settings at any time (GDPR art. 15, 17 and 20). Notification logs are kept for 90 days; busy blocks two days after they end.</li>
      </ul>
    </article>
  );
}
