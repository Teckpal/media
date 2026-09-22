import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { appUrl } from "@/lib/env";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * `metadataBase` is what makes the relative `canonical` and `openGraph.url`
 * values on the marketing pages resolve to absolute URLs (Module 9). Without
 * it Next warns and emits relative ones, which no crawler or link preview can
 * use.
 *
 * Built rather than declared, because `generateMetadata` has to run at request
 * time anyway once the URL comes from the environment.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(appUrl()),
    title: {
      default: "motif Social",
      template: "%s · motif Social",
    },
    description:
      "Plan, schedule and publish across your social accounts from one place.",
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
