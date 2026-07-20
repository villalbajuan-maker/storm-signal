import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import "./editorial.css";
import "./mobile.css";
import "./semantic.css";
import "./story.css";
import "./motion.css";
import "./polish.css";
import "./footer.css";
import "./legal.css";

const title = "Storm Signal — Know which market is worth the drive";
const description = "Tell Storm Signal where your roofing crew is and what kind of storm work you are looking for. See which severe-weather markets are worth checking first.";

export const metadata: Metadata = {
  metadataBase: new URL("https://storm-signal-landing-light.vercel.app"),
  title,
  description,
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "Storm Signal",
    title,
    description,
    images: [{
      url: "/og-storm-signal-light.png",
      width: 1200,
      height: 630,
      alt: "Storm Signal — Know which market is worth the drive.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og-storm-signal-light.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
