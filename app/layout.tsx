import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "RunDB — Real PC Performance for Games",
  description: "Community-driven database of real PC hardware configurations and actual in-game FPS. \"Can my PC run this game? At what settings?\"",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SiteHeader />
        <Providers>
          <main className="flex-1">{children}</main>

          <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
            Real community-driven PC performance data.
            <span className="mx-2">·</span>
            Inspired by ProtonDB, PCPartPicker, and HowLongToBeat.
            <span className="mx-2">·</span>
            <a href="/dashboard" className="underline-offset-2 hover:text-foreground hover:underline">
              Build dashboard
            </a>
          </footer>

          <Toaster position="top-center" richColors closeButton />
        </Providers>
      </body>
    </html>
  );
}
