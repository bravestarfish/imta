export const metadata = { title: "Terms" };

export default function Terms() {
  return (
    <article className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Terms of use</h1>
      <p className="mt-4 text-sm text-muted">Placeholder terms for the public alpha. Replace before general availability.</p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">
        <li>The service is provided as is, without warranty, during the alpha.</li>
        <li>Do not use the service to spam or harass people. Organizers can block accounts; we may suspend abusive accounts.</li>
        <li>The software is open source under the MIT license.</li>
      </ul>
    </article>
  );
}
