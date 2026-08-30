import { PwaRegister } from "@/components/pwa-register";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plex = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Hive — your building can run a 27B",
  description:
    "Join a building swarm. Share compute if you want. Models unlock from pooled phones and laptops. Contributors get paid per token.",
  applicationName: "Hive",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Hive",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#090b08",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${syne.variable} ${plex.variable} h-full`}>
      <body className="min-h-full antialiased">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
