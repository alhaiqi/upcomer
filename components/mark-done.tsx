import { markQuestionAction } from "@/lib/question-progress-actions";
import styles from "./mark-done.module.css";

// Marks one question of the Upcomer Exam done, or undoes the mark (US-21). A plain POST to a server action; the student
// is always the session's. In the personal order (US-28), the student comes back to the personal order.
export function MarkDoneForm({ courseId, groupId, position, done, personal = false }: { courseId: string; groupId: string; position: number; done: boolean; personal?: boolean }) {
  return <form className={styles.mark} action={markQuestionAction}>
    <input type="hidden" name="courseId" value={courseId} />
    <input type="hidden" name="groupId" value={groupId} />
    <input type="hidden" name="position" value={position} />
    <input type="hidden" name="choice" value={done ? "UNDO" : "DONE"} />
    {personal && <input type="hidden" name="order" value="personal" />}
    {done && <span className={styles.done}>✓ Done</span>}
    <button className={done ? styles.undo : styles.button} type="submit" aria-label={done ? `Undo done on question ${position}` : `Mark question ${position} done`}>
      {done ? "Undo" : "Mark done"}
    </button>
  </form>;
}
