import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Code Auction · Live Event Control",
  description: "Real-time quiz, coding auction, help marketplace and event control platform.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
