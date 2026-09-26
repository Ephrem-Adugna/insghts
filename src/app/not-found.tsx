import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="text-[34px]">This page is not in the record.</div>
      <p className="mt-3 text-[16px] text-[var(--fg-muted)]">The laboratory has no such room.</p>
      <Link href="/" className="mt-6">
        Return home
      </Link>
    </div>
  );
}
