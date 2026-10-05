import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUser } from "@/lib/auth";
import { logOutAction } from "@/lib/auth-actions";
import "./globals.css";

export const metadata: Metadata = { title: "Upcomer", description: "Your course resources in one place" };

// Self-hosted at build time; the metrics-matched fallback avoids layout shift while it loads.
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap", variable: "--font-jakarta" });

// Runs before first paint: applies a stored light/dark choice. Without one, CSS follows the device setting.
const themeScript = `try{var t=localStorage.getItem("upcomer-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  return <html lang="en" className={sans.variable} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body><header className="site-header"><div className="site-header-inner">
    <Link className="brand" href="/">Upcomer</Link>
    <div className="header-actions">
      <nav className="site-nav" aria-label="Account">
        {user
          ? <>{user.role === "ADMIN" && <><Link href="/admin/catalog">Admin</Link><Link href="/admin/monitoring">Monitoring</Link></>}<Link href="/my-courses">My Courses</Link><form action={logOutAction}><button type="submit">Log out</button></form></>
          : <><Link href="/login">Log in</Link><Link href="/signup">Sign up</Link></>}
      </nav>
      <ThemeToggle />
    </div>
  </div></header><main className="container">{children}</main></body></html>;
}
