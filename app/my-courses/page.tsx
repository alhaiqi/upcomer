import Link from "next/link";
import { CourseList } from "@/components/course-list";
import { requireUser } from "@/lib/auth";
import { getMyCourses } from "@/lib/my-courses";

export const dynamic = "force-dynamic";

export default async function MyCoursesPage() {
  const user = await requireUser("/my-courses");
  const courses = await getMyCourses(user.id);
  return <><h1>My Courses</h1><p className="muted">The courses you added, most recently added first.</p>
    <CourseList courses={courses} emptyMessage="You haven't added any courses yet." />
    <p><Link className="button" href="/">Browse Courses</Link></p>
  </>;
}
