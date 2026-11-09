import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NRK Jewellers | ERP",
  description: "Jewellery ERP & business management system for NRK Jewellers",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "NRK Jewellers" },
};

export const viewport = {
  themeColor: "#1c140d",
};

// Runs before paint so the selected theme never flashes light on load.
const THEME_INIT_SCRIPT = `
  try {
    var stored = localStorage.getItem("nrk-theme");
    document.documentElement.classList.toggle("dark", stored === "dark");
    var colorTheme = localStorage.getItem("nrk-color-theme");
    document.documentElement.dataset.colorTheme = ["gold", "rose", "green", "plum"].includes(colorTheme) ? colorTheme : "gold";
    document.documentElement.dataset.readingSize = localStorage.getItem("nrk-reading-size") || "standard";
  } catch (e) {}
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
        suppressHydrationWarning
      >
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        </head>
        <body className="min-h-full flex flex-col bg-background text-foreground">
          <ConvexClientProvider>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
