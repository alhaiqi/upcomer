import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Upcomer", description: "Your course resources in one place" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><header className="site-header"><span className="brand">Upcomer</span></header><main className="container">{children}</main></body></html>;
}
