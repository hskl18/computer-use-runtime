import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Computer Use Runtime",
  description: "Discover, inspect, and replay reusable UI capabilities.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
