import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Housify — Find the house in your music",
  description: "A new home for the house music hiding in your playlists. Explore the Housify concept with an interactive mock preview.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
