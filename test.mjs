/**
 * Syllify guarantee tests.
 *
 *   node test.mjs
 *
 * These do not claim the parser finds everything — it does not, and no parser
 * will. They check the promise Syllify actually makes:
 *
 *   1. TRACEABILITY  Every deadline it outputs cites a line that exists in the
 *                    document, and the words of its title appear on that line.
 *                    Nothing is conjured.
 *   2. NO SILENT AI  Nothing a model proposes is accepted unless it passes the
 *                    same check. Fabrications are rejected with a reason.
 *   3. NO INVENTED    A syllabus dated only by session or teaching week produces
 *      DATES          no dates at all until a first class date is supplied.
 *   4. NOT-A-SYLLABUS A resume or an invoice is flagged, not parsed into
 *                    deadlines.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { prepLines, parse, verifyProposals } from "./parser.mjs";

let pass = 0,
  fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
    console.log("  PASS  " + msg);
  } else {
    fail++;
    console.log("  FAIL  " + msg);
  }
};
const head = (t) => console.log("\n" + t);

const words = (t) =>
  String(t || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);

/* ── fixtures ───────────────────────────────────────────────────────────────── */

const CORPUS_DIR = existsSync("./fixtures") ? "./fixtures" : null;

const INLINE = {
  "dated-table.txt": `MKT 3310 Consumer Behavior
Fall 2025 | Tuesdays 9:35-10:55 AM
Instructor: Dr. Marianne Vogel
Week | Date | Topic | Due
2 | Sep 9 | Perception | Reflection paper 1 due Sep 11 by 11:59 PM
3 | Sep 16 | Memory | Read Solomon Ch. 4, pp. 96-131
6 | Oct 7 | Attitudes | Midterm exam, in class
12 | Nov 18 | Presentations | Final project deck due November 20 at 5:00 PM`,

  "prose-list.txt": `CSci 4554 Computer Networks
Spring 2026
Problem set 1 Due Friday, February 6
Problem set 2 Due Friday, February 13
Problem set 3 Was due Friday, February 20, now due Monday, February 23
Final examination 8 May 2026`,

  "session-numbered.txt": `ISE 999 Product Development
Fall 2025 | Wednesdays 4:00-6:50 PM
Assignments are due by 21:59 (9:59 PM), six days after issue.
Session 1: | Course introduction | Ries Ch. 1 | Assignment #1 (Individual) - Intro
Session 2: | Lean methods | Ries Ch. 2 | Assignment #2 (Team) - MVP memo
Session 3: | Agile | Breyter Ch. 3 | Assignment #3 (Team) - Backlog
Session 4: | Metrics | Christensen Ch. 2 | Midterm Exam`,

  "week-numbered.txt": `XAB021 Academic Writing
Semester 2 2025
Assessment Task 1: | Essay Plan | Week 3 | 15 %
Assessment Task 2: | Evidence Quiz | Week 4 | 10 %
Assessment Task 3: | Long Essay | Week 13 | 40 %`,

  "not-a-syllabus-resume.txt": `Jordan Patel
Los Angeles, CA
EXPERIENCE
Analyst Intern, Acme Corp, Jun 2023 - Jan 2024
Built a bottleneck report for the plant manager
EDUCATION
MS Engineering Management, Aug 2024 - May 2026`,

  "not-a-syllabus-invoice.txt": `INVOICE #2291
Date: 03/14/2025   Due: 04/14/2025
Bill to: Acme Corp
Consulting project, phase 1 | 12,000
Total due 20,400`,
};

function fixtures() {
  if (CORPUS_DIR) {
    return readdirSync(CORPUS_DIR)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => [f, readFileSync(CORPUS_DIR + "/" + f, "utf8")]);
  }
  return Object.entries(INLINE);
}

const linesOf = (text) =>
  prepLines(
    text
      .replace(/\r/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );

/* ── 1. traceability ───────────────────────────────────────────────────────── */

head("1. Every deadline traces back to a real line");
let checked = 0;
for (const [name, text] of fixtures()) {
  if (name.startsWith("not-a-syllabus")) continue;
  const lines = linesOf(text);
  const doc = parse(lines, { name, fid: name, termStart: "2025-08-27" });
  let bad = [];
  doc.items.forEach((it) => {
    const idx = it.ln - 1;
    if (!(idx >= 0 && idx < lines.length)) {
      bad.push(it.t + " → line " + it.ln + " does not exist");
      return;
    }
    const src = lines[idx].toLowerCase();
    const w = words(it.t);
    if (w.length && !w.some((x) => src.includes(x))) bad.push(it.t + " → not on line " + it.ln);
    checked++;
  });
  ok(bad.length === 0, name + ": " + doc.items.length + " deadlines, all traceable" + (bad.length ? " — " + bad[0] : ""));
}
ok(checked > 0, checked + " individual deadlines checked for traceability");

/* ── 2. no silent AI ───────────────────────────────────────────────────────── */

head("2. Nothing a model proposes is accepted without checking");
{
  const text = INLINE["dated-table.txt"];
  const lines = linesOf(text);
  const realLine = lines.findIndex((l) => /Reflection paper/i.test(l));
  const proposals = [
    { line: realLine, title: "Reflection paper 1", type: "assignment", date: "2025-09-11", time: "23:59" },
    { line: 99999, title: "Capstone defence", type: "exam", date: "2025-10-01" },
    { line: realLine, title: "Completely unrelated dissertation viva", type: "exam", date: "2025-10-02" },
    { line: realLine, title: "Reflection paper 1", type: "assignment", date: "2031-01-01" },
  ];
  const { kept, rejected } = verifyProposals(proposals, lines, { termStart: "2025-08-27" });
  ok(kept.length === 1, "1 of 4 proposals accepted (the real one)");
  ok(rejected.length === 3, "3 fabrications rejected");
  ok(
    rejected.some((r) => /no real line/.test(r.reason)),
    "rejected: cites a line that does not exist",
  );
  ok(
    rejected.some((r) => /does not appear/.test(r.reason)),
    "rejected: title is not on the line it cites",
  );
  ok(
    rejected.some((r) => /outside the term/.test(r.reason)),
    "rejected: date falls outside the term",
  );
  ok(kept.every((k) => k.verified === true && typeof k.source_line === "string"), "accepted items carry their source line");
}

/* ── 3. no invented dates ──────────────────────────────────────────────────── */

head("3. Undated syllabi are not given invented dates");
for (const name of ["session-numbered.txt", "week-numbered.txt"]) {
  const lines = linesOf(INLINE[name]);
  const blind = parse(lines, { name, fid: name });
  ok(blind.items.length === 0, name + ": produces 0 dated items without a first class date");
  ok(blind.gaps.length > 0, name + ": " + blind.gaps.length + " items listed as undated instead of dropped");
  const told = parse(lines, { name, fid: name, termStart: "2025-08-27" });
  ok(told.items.length > 0, name + ": " + told.items.length + " dated once a first class date is given");
}

/* ── 4. not a syllabus ─────────────────────────────────────────────────────── */

head("4. A document that is not a syllabus is flagged");
for (const name of ["not-a-syllabus-resume.txt", "not-a-syllabus-invoice.txt"]) {
  const doc = parse(linesOf(INLINE[name]), { name, fid: name });
  ok(doc.likely === false, name + ": flagged as not a syllabus (score " + doc.docScore + ")");
}

/* ── result ────────────────────────────────────────────────────────────────── */

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) {
  console.log("\nThe guarantee is broken. Do not ship this build.");
  process.exit(1);
}
console.log("\nGuarantee holds: everything shown traces to the document, and nothing a model");
console.log("proposes gets through unchecked.");
