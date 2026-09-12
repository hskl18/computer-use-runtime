"use client";
import { Button } from "../components/ui/button";
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  return (
    <main className="empty">
      <h1>The console could not render this view.</h1>
      <p>The worker owns active browser sessions independently.</p>
      <Button onClick={reset}>Reload view</Button>
    </main>
  );
}
