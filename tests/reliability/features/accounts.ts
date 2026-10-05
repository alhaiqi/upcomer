import { describe } from "../client";
import { result, type Context, type Feature } from "../context";

// Sign up, log in, log out, and add to My Courses, through the same server actions the forms use.

// Each pattern stays malformed with the run's stamp in it, so cleanup can still find anything wrongly saved.
const BAD_EMAILS: [string, (stamp: string) => string][] = [
  ["no @ sign", stamp => `${stamp}-no-at-sign.example.com`],
  ["two @ signs", stamp => `${stamp}@@example.com`],
  ["a space", stamp => `${stamp} space@example.com`],
  ["no local part", stamp => `@${stamp}.example.com`],
  ["no domain", stamp => `${stamp}@`],
  ["no dot in the domain", stamp => `${stamp}@example`],
];

async function signUp(ctx: Context, fields: { name: string; email: string; password: string }) {
  return ctx.client().postAction("/signup", ctx.actions.signUp, fields);
}

export const signUpFeature: Feature = {
  name: "Sign up",
  trials: [
    {
      name: "valid new account", valid: true,
      async run(ctx) {
        const email = ctx.email();
        const reply = await signUp(ctx, { name: ctx.name("Student"), email: ctx.rng.chance(0.3) ? ctx.rng.mixCase(email) : email, password: ctx.password() });
        const users = await ctx.db.user.count({ where: { email } });
        return result("new stamped email, password of 8+ characters", "303 → /login?registered=1, one account created",
          `${describe(reply)}, ${users} account(s)`, reply.status === 303 && reply.location === "/login?registered=1" && users === 1, reply.ms);
      },
    },
    {
      name: "duplicate email", valid: false,
      async run(ctx) {
        const existing = await ctx.anyStudent();
        const email = ctx.rng.pick([existing.email, existing.email.toUpperCase(), ` ${existing.email} `, ctx.rng.mixCase(existing.email)]);
        const reply = await signUp(ctx, { name: ctx.name("Student"), email, password: ctx.password() });
        const users = await ctx.db.user.count({ where: { email: existing.email } });
        return result("an existing account's email (random case and spacing)", "303 → /signup?error=email_taken, still one account",
          `${describe(reply)}, ${users} account(s)`, reply.location === "/signup?error=email_taken" && users === 1, reply.ms);
      },
    },
    {
      name: "short password", valid: false,
      async run(ctx) {
        const email = ctx.email();
        const reply = await signUp(ctx, { name: ctx.name("Student"), email, password: ctx.rng.letters(ctx.rng.int(0, 7)) });
        const users = await ctx.db.user.count({ where: { email } });
        return result("new email, password of 0–7 characters", "303 → /signup?error=weak_password, no account",
          `${describe(reply)}, ${users} account(s)`, reply.location === "/signup?error=weak_password" && users === 0, reply.ms);
      },
    },
    {
      name: "bad email", valid: false,
      async run(ctx) {
        const before = await ctx.db.user.count();
        const [flaw, makeEmail] = ctx.rng.pick(BAD_EMAILS);
        const reply = await signUp(ctx, { name: ctx.name("Student"), email: makeEmail(ctx.stamp.toLowerCase()), password: ctx.password() });
        const after = await ctx.db.user.count();
        return result(`malformed email (${flaw})`, "303 → /signup?error=invalid_email, no account",
          `${describe(reply)}, accounts ${before} → ${after}`, reply.location === "/signup?error=invalid_email" && after === before, reply.ms);
      },
    },
    {
      name: "missing name", valid: false,
      async run(ctx) {
        const email = ctx.email();
        const reply = await signUp(ctx, { name: ctx.rng.pick(["", "   "]), email, password: ctx.password() });
        const users = await ctx.db.user.count({ where: { email } });
        return result("empty or blank name", "303 → /signup?error=name_required, no account",
          `${describe(reply)}, ${users} account(s)`, reply.location === "/signup?error=name_required" && users === 0, reply.ms);
      },
    },
  ],
};

export const logInFeature: Feature = {
  name: "Log in",
  trials: [
    {
      name: "correct password", valid: true,
      async run(ctx) {
        const student = await ctx.anyStudent();
        const client = ctx.client();
        const email = ctx.rng.pick([student.email, student.email.toUpperCase(), ` ${student.email}`]);
        const reply = await client.postAction("/login", ctx.actions.logIn, { email, password: student.password });
        const myCourses = client.session ? (await client.get("/my-courses")).status : 0;
        return result("existing account, correct password (random email case/spacing)", "303 → /my-courses with a session; /my-courses opens (200)",
          `${describe(reply)}, session ${client.session ? "set" : "missing"}, /my-courses ${myCourses}`,
          reply.location === "/my-courses" && Boolean(client.session) && myCourses === 200, reply.ms);
      },
    },
    {
      name: "wrong password", valid: false,
      async run(ctx) {
        const student = await ctx.anyStudent();
        const client = ctx.client();
        const password = ctx.rng.pick([ctx.password(), student.password.toUpperCase(), `${student.password}x`, ""]);
        const reply = await client.postAction("/login", ctx.actions.logIn, { email: student.email, password });
        return result("existing account, wrong password", "303 → /login?error=invalid_credentials, no session",
          `${describe(reply)}, session ${client.session ? "set" : "none"}`, reply.location === "/login?error=invalid_credentials" && !client.session, reply.ms);
      },
    },
    {
      name: "unknown email", valid: false,
      async run(ctx) {
        const client = ctx.client();
        const reply = await client.postAction("/login", ctx.actions.logIn, { email: `nobody-${ctx.email()}`, password: ctx.password() });
        return result("email with no account", "303 → /login?error=invalid_credentials, no session",
          `${describe(reply)}, session ${client.session ? "set" : "none"}`, reply.location === "/login?error=invalid_credentials" && !client.session, reply.ms);
      },
    },
  ],
};

export const logOutFeature: Feature = {
  name: "Log out",
  trials: [
    {
      name: "logged-in student", valid: true,
      async run(ctx) {
        const student = await ctx.anyStudent();
        const client = await ctx.logIn(student.email, student.password);
        const token = client.session;
        const reply = await client.postAction("/", ctx.actions.logOut, {});
        // The old cookie must no longer open My Courses.
        const replay = ctx.client();
        replay.setSession(token);
        const after = await replay.get("/my-courses");
        const ok = reply.location === "/" && !client.session && [303, 307, 308].includes(after.status) && after.location.startsWith("/login");
        return result("a fresh session", "303 → /, cookie cleared, the old session no longer opens /my-courses",
          `${describe(reply)}, cookie ${client.session ? "kept" : "cleared"}, old session on /my-courses: ${describe(after)}`, ok, reply.ms);
      },
    },
    {
      name: "no session", valid: true,
      async run(ctx) {
        const reply = await ctx.client().postAction("/", ctx.actions.logOut, {});
        return result("log out without being logged in", "303 → / (nothing to end, no error)", describe(reply), reply.status === 303 && reply.location === "/", reply.ms);
      },
    },
    {
      name: "forged session cookie", valid: false,
      async run(ctx) {
        const client = ctx.client();
        client.setSession(ctx.rng.letters(43, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"));
        const before = await ctx.db.session.count();
        const reply = await client.postAction("/", ctx.actions.logOut, {});
        const after = await ctx.db.session.count();
        return result("a random session token nobody has", "303 → /, no session deleted",
          `${describe(reply)}, sessions ${before} → ${after}`, reply.location === "/" && after === before, reply.ms);
      },
    },
  ],
};

export const addToMyCoursesFeature: Feature = {
  name: "Add to My Courses",
  trials: [
    {
      name: "new course", valid: true,
      async run(ctx) {
        const courses = await ctx.db.course.findMany({ where: { NOT: { code: { startsWith: ctx.stamp } } }, select: { id: true } });
        // A student who hasn't added every course yet; a new one when all have.
        let student = ctx.students.find(item => item.client.session);
        let course: { id: string } | undefined;
        for (const candidate of ctx.rng.subset(ctx.students).concat(ctx.students)) {
          const added = new Set((await ctx.db.userCourse.findMany({ where: { userId: candidate.id }, select: { courseId: true } })).map(item => item.courseId));
          course = courses.find(item => !added.has(item.id));
          if (course) { student = candidate; break; }
        }
        if (!course || !student) { student = await ctx.newStudent(); course = ctx.rng.pick(courses); }
        const reply = await student.client.postAction(`/courses/${course.id}`, ctx.actions.addCourse, { courseId: course.id });
        const rows = await ctx.db.userCourse.count({ where: { userId: student.id, courseId: course.id } });
        return result("logged-in student, a course not yet in My Courses", `303 → /courses/<id>?added=1, one entry`,
          `${describe(reply)}, ${rows} entr(ies)`, reply.location === `/courses/${course.id}?added=1` && rows === 1, reply.ms);
      },
    },
    {
      name: "duplicate", valid: false,
      async run(ctx) {
        const entries = await ctx.db.userCourse.findMany({ where: { userId: { in: ctx.students.map(item => item.id) } } });
        let entry = entries.length ? ctx.rng.pick(entries) : undefined;
        let student = entry && ctx.students.find(item => item.id === entry!.userId);
        if (!entry || !student) {
          student = await ctx.anyStudent();
          const course = await ctx.db.course.findFirstOrThrow({ select: { id: true } });
          await student.client.postAction(`/courses/${course.id}`, ctx.actions.addCourse, { courseId: course.id });
          entry = await ctx.db.userCourse.findFirstOrThrow({ where: { userId: student.id } });
        }
        const reply = await student.client.postAction(`/courses/${entry.courseId}`, ctx.actions.addCourse, { courseId: entry.courseId });
        const rows = await ctx.db.userCourse.count({ where: { userId: student.id, courseId: entry.courseId } });
        return result("a course already in My Courses", "303 → /courses/<id>?added=already, still one entry",
          `${describe(reply)}, ${rows} entr(ies)`, reply.location === `/courses/${entry.courseId}?added=already` && rows === 1, reply.ms);
      },
    },
    {
      name: "unknown course", valid: false,
      async run(ctx) {
        const student = await ctx.anyStudent();
        const courseId = ctx.rng.pick([`${ctx.stamp.toLowerCase()}-no-such-course`, ctx.rng.letters(25), "../admin", ""]);
        // Posted from a real course page, as a tampered form would be; the action exists only on course pages.
        const page = ctx.rng.pick(await ctx.db.course.findMany({ select: { id: true } }));
        const before = await ctx.db.userCourse.count({ where: { userId: student.id } });
        const reply = await student.client.postAction(`/courses/${page.id}`, ctx.actions.addCourse, { courseId });
        const after = await ctx.db.userCourse.count({ where: { userId: student.id } });
        return result("a course ID that does not exist", "404, nothing added", `${describe(reply)}, entries ${before} → ${after}`, reply.status === 404 && after === before, reply.ms);
      },
    },
    {
      name: "not logged in", valid: false,
      async run(ctx) {
        const course = ctx.rng.pick(await ctx.db.course.findMany({ select: { id: true } }));
        const before = await ctx.db.userCourse.count();
        const reply = await ctx.client().postAction(`/courses/${course.id}`, ctx.actions.addCourse, { courseId: course.id });
        const after = await ctx.db.userCourse.count();
        return result("a visitor without a session", "303 → /login?next=/courses/<id>, nothing added",
          `${describe(reply)}, entries ${before} → ${after}`, reply.location.startsWith("/login?next=") && after === before, reply.ms);
      },
    },
  ],
};
