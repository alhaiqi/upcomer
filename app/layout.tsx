import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { logOutAction } from "@/lib/auth-actions";
import "./globals.css";

export const metadata: Metadata = { title: "Upcomer", description: "Your course resources in one place" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  return <html lang="en"><body><header className="site-header">
    <Link className="brand" href="/">Upcomer</Link>
    <nav className="site-nav" aria-label="Account">
      {user
        ? <>{user.role === "ADMIN" && <><Link href="/admin/catalog">Admin</Link><Link href="/admin/monitoring">Monitoring</Link></>}<Link href="/my-courses">My Courses</Link><form action={logOutAction}><button type="submit">Log out</button></form></>
        : <><Link href="/login">Log in</Link><Link href="/signup">Sign up</Link></>}
    </nav>
  </header><main className="container">{children}</main></body></html>;
}
