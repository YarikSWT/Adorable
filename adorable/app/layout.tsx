import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import { WorkspaceFrame } from "./workspace-frame";
import { ApiKeyGate } from "@/components/api-key-gate";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Sunbaked display face — used for hero, plan prices, italic accent words.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Adorable",
  description: "Build beautiful apps with AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark h-full overflow-hidden ${geistSans.variable} ${geistMono.variable} ${fraunces.variable}`}
    >
      <body className="h-full overflow-hidden overscroll-none antialiased">
        <ApiKeyGate>
          <WorkspaceFrame>{children}</WorkspaceFrame>
        </ApiKeyGate>
      </body>
    </html>
  );
}
