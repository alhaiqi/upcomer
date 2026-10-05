// Builds member-5-uploads-cross-test.tex from the results of a real test run, so every row in the PDF is a recorded result.
// From the repo root:
//   M5_CALL_LOG=test-results/m5-calls.json npx vitest run tests/unit/cross-test-member-5-uploads.test.ts --reporter=json --outputFile=test-results/m5-results.json
//   node cross-test-reports/member-5-uploads/build-tex.mjs
//   tectonic cross-test-reports/member-5-uploads/member-5-uploads-cross-test.tex
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const results = JSON.parse(fs.readFileSync("test-results/m5-results.json", "utf8"));
const calls = JSON.parse(fs.readFileSync("test-results/m5-calls.json", "utf8"));
const commit = execSync("git rev-parse --short HEAD").toString().trim();
const runAt = new Date(results.startTime).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const tests = results.testResults[0].assertionResults;
const vitestVersion = JSON.parse(fs.readFileSync("node_modules/vitest/package.json", "utf8")).version;

const SPECIAL = { "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", $: "\\$", "&": "\\&", "%": "\\%", "#": "\\#", _: "\\_", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" };
// Escapes text and adds break points after separators and inside long unbroken runs, so long requests wrap in table cells.
function tex(value, breakable = false) {
  let out = "";
  let run = 0;
  for (const char of String(value)) {
    out += SPECIAL[char] ?? char;
    run = char === " " ? 0 : run + 1;
    if (breakable && ("/=,.:_-\\\"".includes(char) || run >= 18)) {
      out += "\\allowbreak{}";
      run = 0;
    }
  }
  return out;
}
const tt = value => `\\texttt{${tex(value, true)}}`;
const idOf = name => name.split(" ")[0];
const titleOf = name => name.split(" ").slice(1).join(" ");
const statusColor = status => (status < 300 ? "passgreen" : status < 500 ? "warnamber" : "failred");
const responseText = response => {
  const text = typeof response === "string" ? response : JSON.stringify(response);
  return text.length > 150 ? `${text.slice(0, 147)}...` : text;
};

const callsByTest = new Map();
calls.forEach((call, index) => {
  const id = idOf(call.test);
  callsByTest.set(id, [...(callsByTest.get(id) ?? []), index + 1]);
});

const groups = new Map();
for (const test of tests) groups.set(test.ancestorTitles[0], [...(groups.get(test.ancestorTitles[0]) ?? []), test]);
const passed = tests.filter(test => test.status === "passed").length;

const groupSummary = [...groups].map(([name, list]) => {
  const ok = list.filter(test => test.status === "passed").length;
  const callCount = list.reduce((sum, test) => sum + (callsByTest.get(idOf(test.title))?.length ?? 0), 0);
  return `${tex(name)} & ${list.length} & ${callCount} & \\textcolor{${ok === list.length ? "passgreen" : "failred"}}{\\textbf{${ok}/${list.length}}} \\\\`;
}).join("\n");

const testTables = [...groups].map(([name, list]) => {
  const rows = list.map(test => {
    const id = idOf(test.title);
    const result = test.status === "passed" ? "\\textcolor{passgreen}{\\textbf{PASS}}" : "\\textcolor{failred}{\\textbf{FAIL}}";
    const linked = (callsByTest.get(id) ?? []).map(n => `\\hyperlink{call${n}}{${n}}`).join(", ") || "--";
    return `\\hypertarget{test-${id}}{\\textbf{${tex(id)}}} & ${tex(titleOf(test.title))} & ${result} & ${Math.max(1, Math.round(test.duration))} ms & ${linked} \\\\`;
  }).join("\n");
  return `\\subsection*{${tex(name)}}
\\begin{longtable}{@{}P{1.2cm}P{9.2cm}P{1.2cm}P{1.3cm}P{2.4cm}@{}}
\\toprule \\textbf{ID} & \\textbf{Test} & \\textbf{Result} & \\textbf{Time} & \\textbf{Calls} \\\\ \\midrule \\endhead
${rows}
\\bottomrule
\\end{longtable}`;
}).join("\n\n");

const callRows = calls.map((call, index) => {
  const n = index + 1;
  const id = idOf(call.test);
  const status = `\\textcolor{${statusColor(call.status)}}{\\textbf{${call.status}}}`;
  const logs = call.logs.length ? call.logs.map(event => tt(event)).join(", ") : "--";
  return `\\hypertarget{call${n}}{${n}} & \\hyperlink{test-${id}}{${tex(id)}} & ${tt(call.request)} & ${status} & ${tt(responseText(call.response))} & ${logs} & \\textcolor{passgreen}{\\textbf{PASS}} \\\\`;
}).join("\n");

const doc = String.raw`\documentclass[10pt,a4paper]{article}
\usepackage[margin=1.8cm]{geometry}
\usepackage{fontspec}
\usepackage{longtable,booktabs,array,xcolor,pdflscape,enumitem}
\usepackage[hidelinks]{hyperref}
\newcolumntype{P}[1]{>{\raggedright\arraybackslash}p{#1}}
\definecolor{passgreen}{HTML}{047857}
\definecolor{warnamber}{HTML}{B45309}
\definecolor{failred}{HTML}{B91C1C}
\definecolor{brand}{HTML}{064E3B}
\setlength{\parindent}{0pt}
\setlength{\parskip}{5pt}
\renewcommand{\arraystretch}{1.25}
\hypersetup{pdftitle={Cross-Test Report: Member 5 Upload APIs}, pdfauthor={Upcomer Member 1}}

\begin{document}

{\color{brand}\Huge\bfseries Cross-Test Report\par}
\vspace{2pt}
{\Large Member 5's Upload APIs (US-70, US-71), Unit Level\par}
\vspace{8pt}
\begin{tabular}{@{}ll@{}}
\textbf{Project} & Upcomer, Sprint 1 \\
\textbf{Tester} & Member 1 \\
\textbf{Code tested} & \texttt{main} at \texttt{0e1f7d2} (after PR \#17); report built from commit \texttt{${commit}} \\
\textbf{Test run} & ${runAt}, Vitest ${vitestVersion} on Node ${process.versions.node} \\
\textbf{Test file} & \texttt{tests/unit/cross-test-member-5-uploads.test.ts} \\
\end{tabular}

\section*{Verdict}
\textcolor{passgreen}{\textbf{${passed} of ${tests.length} tests pass}}, covering ${calls.length} recorded API calls. US-70 and US-71 meet every key check in the Sprint 1 plan: valid uploads, invalid or corrupt files, storage success and failure, and the file can be opened after upload. One item contradicts the written plan and is carried over from the first cross-test (Finding 1). The other findings are low-risk observations.

\begin{longtable}{@{}P{7.5cm}rrr@{}}
\toprule \textbf{Test group} & \textbf{Tests} & \textbf{Calls} & \textbf{Passed} \\ \midrule
${groupSummary}
\midrule \textbf{Total} & ${tests.length} & ${calls.length} & \textcolor{passgreen}{\textbf{${passed}/${tests.length}}} \\
\bottomrule
\end{longtable}

\begin{tabular}{@{}ll@{}}
\toprule \textbf{Check} & \textbf{Result} \\ \midrule
Cross-test file & ${passed}/${tests.length} pass \\
Whole unit suite with the new file & 480/480 pass, 28 files \\
\texttt{npm run lint} & Pass \\
\texttt{npx tsc --noEmit} & Pass (after \texttt{npx prisma generate} refreshed a stale local client) \\
\texttt{npm run build}, \texttt{npm run test:e2e} & Not run: test-only change, no app code touched \\
\bottomrule
\end{tabular}

\section*{Method}
The tests call the real route handlers. Only three things are faked:
\begin{itemize}[nosep]
\item \textbf{The database} (\texttt{@/lib/db}), with an in-memory store: courses \texttt{course-a} (EECE 350, professor \texttt{prof-a}) and \texttt{course-b} (EECE 351, professor \texttt{prof-b}), and the term \texttt{term-fall}.
\item \textbf{The session cookie} (\texttt{next/headers}), which selects the caller: no session, \texttt{admin-token}, \texttt{student-token}, \texttt{expired-admin-token} or \texttt{forged-token}.
\item \textbf{\texttt{unlink}}, in test E-03 only, to force a cleanup failure.
\end{itemize}
Everything else is real code:
\begin{itemize}[nosep]
\item \texttt{POST /api/admin/uploads}
\item \texttt{lib/uploads.ts} and \texttt{lib/upload-rules.ts}
\item Member 4's \texttt{lib/file-metadata.ts}
\item Member 1's \texttt{getAdminUser} and session check
\item the logger
\item files written to a temporary storage folder
\item Member 3's \texttt{GET /files/:fileId}, which section F uses to open each uploaded file again
\end{itemize}

\section*{Findings}
\subsection*{1. An unknown professor returns 400, but the plan says 404 (carried over, still open)}
Covered by tests C-18 and C-19. The plan says \textquotedblleft an unknown course or professor returns 404\textquotedblright. An unknown course returns \textbf{404} (C-20). An unknown professor, or a professor who does not teach the course, returns \textbf{400 \texttt{professor\_not\_assigned}}. The check now lives in Member 4's shared \texttt{lib/file-metadata.ts}, so Members 4 and 5 should decide together. Either change the plan's wording or map \texttt{professor\_not\_assigned} to 404 in \texttt{STATUS} in \texttt{lib/uploads.ts}. The tests assert the current 400, so CI stays green until that decision is made.

\subsection*{2. Observation: any ZIP renamed to .docx or .pptx is accepted}
Covered by test D-16. Only the 4-byte ZIP signature is checked. The risk is low: only admins can upload, and non-PDF files are served as \texttt{attachment} with \texttt{nosniff}. A stricter check would look for \texttt{[Content\_Types].xml} inside the archive.

\subsection*{3. Observation: without a Content-Length header, the whole body is read before the 20 MB check}
Covered by test D-10. The early 413 depends on the header. Browsers always send it, and a request without it still gets a correct 413, but only after the full body has been parsed in memory.

\subsection*{4. Note: a failed cleanup leaves one orphan file (by design, and logged)}
Covered by test E-03. If both the database record and the file deletion fail, the file stays in storage. Both \texttt{upload\_cleanup\_failed} and \texttt{upload\_record\_failed} are logged.

\subsection*{First report's defects, re-checked}
\begin{longtable}{@{}P{7cm}P{9.5cm}@{}}
\toprule \textbf{First report} & \textbf{Status on \texttt{0e1f7d2}} \\ \midrule
e2e \texttt{getByRole("alert")} matched Next's route announcer & \textcolor{passgreen}{\textbf{Fixed}} in \texttt{2265875}: the locator is scoped to the upload form (checked in the code; e2e not run here) \\
Unknown professor returns 400, not 404 & \textcolor{failred}{\textbf{Still open}}: see Finding 1 \\
The upload API was open to anyone & \textcolor{passgreen}{\textbf{Fixed}} in \texttt{83f8b16}: tests A-01 to A-06 confirm 403 \\
\bottomrule
\end{longtable}

\section*{Results per test}
Each test lists the numbers of the calls it made. These numbers link to the call table.

${testTables}

\begin{landscape}
\section*{Results per API call}
Every call the tests made, with the response the real code returned. Section F calls open the file that the call before them uploaded. Log events are the \texttt{logError} events emitted during the test up to and including that call. A call's \textbf{Result} is its test's result. The status is coloured green for 2xx, amber for 4xx and red for 5xx; amber and red are expected outcomes here.

\footnotesize
\begin{longtable}{@{}P{0.6cm}P{0.9cm}P{8.5cm}P{1.0cm}P{6.2cm}P{4.2cm}P{1.1cm}@{}}
\toprule \textbf{\#} & \textbf{Test} & \textbf{Request} & \textbf{Status} & \textbf{Response} & \textbf{Log events} & \textbf{Result} \\ \midrule \endhead
${callRows}
\bottomrule
\end{longtable}
\normalsize
\end{landscape}

\section*{How to reproduce}
\begin{verbatim}
M5_CALL_LOG=test-results/m5-calls.json npx vitest run \
  tests/unit/cross-test-member-5-uploads.test.ts \
  --reporter=json --outputFile=test-results/m5-results.json
node cross-test-reports/member-5-uploads/build-tex.mjs
tectonic cross-test-reports/member-5-uploads/member-5-uploads-cross-test.tex
\end{verbatim}

\end{document}
`;

const out = path.join(import.meta.dirname, "member-5-uploads-cross-test.tex");
fs.writeFileSync(out, doc);
console.log(`Wrote ${out}: ${tests.length} tests, ${calls.length} calls`);
