import { PrismaClient, FileCategory, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("Skipping the admin user: set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
    return;
  }
  const name = process.env.ADMIN_NAME?.trim() || "Upcomer Admin";
  const passwordHash = await bcrypt.hash(password, 10);
  await db.user.upsert({
    where: { email },
    update: { name, passwordHash, role: Role.ADMIN },
    create: { email, name, passwordHash, role: Role.ADMIN },
  });
}

async function main() {
  const engineering = await db.faculty.upsert({ where: { code: "ENG" }, update: {}, create: { id: "faculty-eng", code: "ENG", name: "Faculty of Engineering" } });
  const arts = await db.faculty.upsert({ where: { code: "FAS" }, update: {}, create: { id: "faculty-fas", code: "FAS", name: "Faculty of Arts and Sciences" } });
  const professors = await Promise.all([
    db.professor.upsert({ where: { id: "prof-a" }, update: {}, create: { id: "prof-a", name: "Professor A" } }),
    db.professor.upsert({ where: { id: "prof-b" }, update: {}, create: { id: "prof-b", name: "Professor B" } }),
    db.professor.upsert({ where: { id: "prof-c" }, update: {}, create: { id: "prof-c", name: "Professor C" } }),
  ]);
  const courses = await Promise.all([
    db.course.upsert({ where: { code: "EECE350" }, update: {}, create: { id: "course-eece350", code: "EECE350", name: "Computer Networks", facultyId: engineering.id } }),
    db.course.upsert({ where: { code: "EECE330" }, update: {}, create: { id: "course-eece330", code: "EECE330", name: "Data Structures", facultyId: engineering.id } }),
    db.course.upsert({ where: { code: "MATH201" }, update: {}, create: { id: "course-math201", code: "MATH201", name: "Calculus III", facultyId: arts.id } }),
  ]);
  for (let index = 0; index < courses.length; index++) {
    await db.courseProfessor.upsert({ where: { courseId_professorId: { courseId: courses[index].id, professorId: professors[index].id } }, update: {}, create: { courseId: courses[index].id, professorId: professors[index].id } });
  }
  const files: Array<{ id: string; courseId: string; professorId: string; title: string; storageKey: string; category: FileCategory; year?: number; session?: string; topic?: string }> = [
    { id: "file-eece350-final", courseId: courses[0].id, professorId: professors[0].id, title: "Final Exam 2025", storageKey: "eece350-final-2025.pdf", category: "EXAM", year: 2025, session: "Final" },
    { id: "file-eece350-midterm", courseId: courses[0].id, professorId: professors[0].id, title: "Midterm 2024", storageKey: "eece350-midterm-2024.pdf", category: "EXAM", year: 2024, session: "Midterm" },
    { id: "file-eece350-notes", courseId: courses[0].id, professorId: professors[0].id, title: "Network Models Lecture", storageKey: "eece350-network-models.pdf", category: "MATERIAL", topic: "Network Models" },
    { id: "file-eece330-final", courseId: courses[1].id, professorId: professors[1].id, title: "Data Structures Final 2025", storageKey: "eece330-final-2025.pdf", category: "EXAM", year: 2025, session: "Final" },
    { id: "file-eece330-notes", courseId: courses[1].id, professorId: professors[1].id, title: "Trees and Graphs Notes", storageKey: "eece330-trees-notes.pdf", category: "MATERIAL", topic: "Trees and Graphs" },
    { id: "file-math201-formulas", courseId: courses[2].id, professorId: professors[2].id, title: "Calculus Formula Sheet", storageKey: "math201-formulas.pdf", category: "MATERIAL", topic: "Calculus" },
    { id: "file-missing", courseId: courses[2].id, professorId: professors[2].id, title: "Unavailable Sample", storageKey: "missing-sample.pdf", category: "EXAM" },
  ];
  for (const file of files) {
    await db.courseFile.upsert({ where: { id: file.id }, update: {}, create: { ...file, originalFileName: file.storageKey, mimeType: "application/pdf" } });
  }
  await seedAdmin();
}

main().finally(() => db.$disconnect());
