import "./globals.css";
import { Inter, Fraunces } from "next/font/google";
import { Nav } from "../components/Nav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata = {
  title: "Brindle — livestock genetics auctions",
  description: "Breeders run their own timed and live sales. One credit approval, every seller's sale.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
