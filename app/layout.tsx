import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UNKAN — Karar masası",
  description: "Kaos içeri girer. Tek karar dışarı çıkar.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
