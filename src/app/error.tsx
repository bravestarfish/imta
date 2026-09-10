"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="py-20 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">{error.message || "Unexpected error."}</p>
      <button className="btn-secondary mt-6" onClick={reset}>Try again</button>
    </div>
  );
}
