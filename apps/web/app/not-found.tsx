import Link from "next/link";
export default function NotFound() {
  return (
    <main className="empty">
      <h1>View not found</h1>
      <Link href="/">Return to the runtime</Link>
    </main>
  );
}
