import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Doppelgänger",
  description: "Trust no one, not even your own voice",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.cdnfonts.com/css/cs-gordon"
          rel="stylesheet"
        />
        <link
          href="https://fonts.cdnfonts.com/css/itc-benguiat-std"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
