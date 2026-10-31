import Link from "next/link";
import styles from "./order-switch.module.css";

// Switches the Upcomer Exam between the frequency order (US-18) and the student's personal order (US-28). Plain links, so
// switching back is just the exam's address without ?order=personal.
export function OrderSwitch({ route, personal }: { route: string; personal: boolean }) {
  return <nav className={styles.switch} aria-label="Question order">
    <Link href={route} aria-current={personal ? undefined : "page"}>Frequency order</Link>
    <Link href={`${route}?order=personal`} aria-current={personal ? "page" : undefined}>Personal order</Link>
  </nav>;
}
