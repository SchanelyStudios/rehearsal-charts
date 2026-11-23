import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rehearsal Chart",
  description: "Make printable chord charts that follow your sheet music."
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
