import "./globals.css";

export const metadata = { title: "Brindle — genetics auctions" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
