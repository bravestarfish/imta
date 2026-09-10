import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-muted">That page or booking link does not exist.</p>
      <Link href="/" className="btn-secondary mt-6">Home</Link>
    </div>
  );
}
