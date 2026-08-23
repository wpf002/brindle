import "./globals.css";
import { Inter, Fraunces } from "next/font/google";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["400", "500", "600"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3010";
const DESCRIPTION =
  "Breeders run their own timed and live cattle sales. Verified EPDs, side-by-side " +
  "comparison, and one credit approval that works across every seller.";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Brindle — livestock genetics auctions",
    template: "%s | Brindle",
  },
  description: DESCRIPTION,
  openGraph: {
    siteName: "Brindle",
    title: "Brindle — livestock genetics auctions",
    description: DESCRIPTION,
    type: "website",
  },
  twitter: { card: "summary", title: "Brindle", description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        {/* Keyboard users land here first — lets them jump the nav. */}
        <a href="#main" className="skip-link">Skip to content</a>
        <Nav />
        <div id="main">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
