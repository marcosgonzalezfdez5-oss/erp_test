import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { TRPCProvider } from "@/lib/trpc/provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "erp_test",
  description: "AI-native ERP — sales workflow core",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { userId } = await auth();

  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      taskUrls={{ "choose-organization": "/dashboard" }}
    >
      <html
        lang="en"
        suppressHydrationWarning
        className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      >
        <body className="flex min-h-full flex-col">
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <TooltipProvider delayDuration={200}>
              <TRPCProvider>
                {userId ? <AppShell>{children}</AppShell> : children}
              </TRPCProvider>
              <Toaster />
            </TooltipProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
