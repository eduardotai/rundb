import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeShell } from "@/components/theme/theme-shell";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";
import { Analytics } from "@vercel/analytics/next";
import { getStaffAccess } from "@/lib/admin-access";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user, isAdmin } = await getStaffAccess();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>
          <ThemeShell user={user} isAdmin={isAdmin}>
            {children}
          </ThemeShell>
          <Toaster position="top-center" richColors closeButton />
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
