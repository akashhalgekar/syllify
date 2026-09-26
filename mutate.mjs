/**
 * Robustness matrix.
 *
 * We could not obtain 30 real syllabi (no open web access this session). But what
 * actually differs between one school's syllabus and another's is FORMATTING. So:
 * take the 9 real, hand-scored syllabi and apply ten transformations that each
 * mirror a real inter-institution difference, then check whether the parser still
 * finds the same deadlines it found in the untouched original.
 *
 * 9 real documents x 10 transformations = 90 derived cases, with ground truth
 * inherited from the original. Honest about what it is: a stability test, not
 * evidence about 30 new institutions.
 */
import { readFileSync, readdirSync } from "node:fs";
import { prepLines, parse } from "/home/claude/package/parser.mjs";

const DIR = "/home/claude/package/fixtures";
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONFULL = { january:0, february:1, march:2, april:3, may:4, june:5, july:6,
  august:7, september:8, october:9, november:10, december:11,
  jan:0, feb:1, mar:2, apr:3, jun:5, jul:6, aug:7, sep:8, sept:8, oct:9, nov:10, dec:11 };

const yearOf = t => (t.match(/\b(20\d{2})\b/) || [])[1] || "2025";

/* Rewrite every "Sep 9" / "September 9th" into another notation. */
function renumber(text, fmt) {
  const yr = yearOf(text);
  return text.replace(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi,
    (m, mo, d) => {
      const mi = MONFULL[mo.toLowerCase()];
      if (mi === undefined) return m;
      const M = mi + 1, D = +d;
      if (fmt === "md") return M + "/" + D;
      if (fmt === "dmy") return D + "/" + M + "/" + yr;
      if (fmt === "dotted") return String(D).padStart(2, "0") + "." + String(M).padStart(2, "0") + "." + yr;
      return m;
    });
}

const POLICY_BLOCK = [
  "EXAMS",
  "Exams are open book open note.",
  "The Midterm will cover material taught in the first half of the class. You CANNOT be exempted",
  "from the Midterm. NO MAKE-UPS OF Midterm WILL BE GIVEN.",
  "The Final will be a take-home exam. Details will be explained in class.",
  "ACADEMIC INTEGRITY",
  "You may not submit work written by others or recycle work prepared for other courses.",
  "Please ask your instructor if you are unsure what constitutes unauthorized assistance.",
  "Once a student has completed the accommodation process, they should contact the instructor.",
].join("\n");

const TRANSFORMS = {
  baseline:  t => t,
  tabs:      t => t.replace(/\s*\|\s*/g, "\t"),
  numeric_md:  t => renumber(t, "md"),
  numeric_dmy: t => renumber(t, "dmy"),
  dotted:      t => renumber(t, "dotted"),
  no_year:   t => t.replace(/\b20\d{2}\b/, ""),
  upper:     t => t.toUpperCase(),
  wrap60:    t => t.split("\n").map(l => l.length <= 60 ? l
                 : l.replace(/(.{1,60})(\s|$)/g, "$1\n").trim()).join("\n"),
  policy:    t => { const L = t.split("\n"); L.splice(Math.min(3, L.length), 0, POLICY_BLOCK); return L.join("\n"); },
  furniture: t => { const L = t.split("\n"), o = [];
                 L.forEach((l, i) => { o.push(l); if (i % 6 === 5) o.push("Page " + (i / 6 | 0) + " of 9"); }); return o.join("\n"); },
  date_last: t => t.split("\n").map(l => {
                 if (!l.includes("|")) return l;
                 const c = l.split("|").map(x => x.trim());
                 const di = c.findIndex(x => /^[A-Za-z]{3,9}\.?\s+\d{1,2}|^\d{1,2}[-/]\w{3}/.test(x));
                 if (di < 0) return l;
                 const d = c.splice(di, 1)[0]; c.push(d); return c.join(" | ");
               }).join("\n"),
};

const L = t => prepLines(t.replace(/\r/g, "").split("\n").map(x => x.trim()).filter(Boolean));
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 26);
const run = (text, opts = {}) => {
  const d = parse(L(text), { name: "x", fid: "x", ...opts });
  return { dates: new Set(d.items.map(i => i.d)), n: d.items.length, gaps: d.gaps.length,
           keys: new Set(d.items.map(i => i.d + "|" + norm(i.t))) };
};

const files = readdirSync(DIR).filter(f => f.endsWith(".txt")).sort();
const names = Object.keys(TRANSFORMS).filter(k => k !== "baseline");
const tally = {};
names.forEach(n => tally[n] = { stable: 0, files: 0, lost: 0, gained: 0, detail: [] });

for (const f of files) {
  const raw = readFileSync(DIR + "/" + f, "utf8");
  const base = run(raw);
  if (!base.n) continue;                       // undated syllabi have nothing to preserve
  for (const t of names) {
    let out;
    try { out = run(TRANSFORMS[t](raw)); }
    catch (e) { console.log("  HARNESS ERROR in " + t + " on " + f + ": " + e.message); continue; }
    const cmp = t === "no_year"
      ? { a: new Set([...base.dates].map(x => x.slice(5))), b: new Set([...out.dates].map(x => x.slice(5))) }
      : { a: base.dates, b: out.dates };
    const lost = [...cmp.a].filter(x => !cmp.b.has(x)).length;
    const gained = [...cmp.b].filter(x => !cmp.a.has(x)).length;
    const T = tally[t];
    T.files++; T.lost += lost; T.gained += gained;
    if (!lost && !gained) T.stable++;
    else T.detail.push(f.replace(".txt", "") + " (-" + lost + " +" + gained + ", " + base.n + "→" + out.n + ")");
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log("\nROBUSTNESS MATRIX — 9 real syllabi under 10 realistic format changes\n");
console.log(pad("transformation", 14) + pad("files intact", 14) + pad("dates lost", 12) + pad("spurious", 10) + "where it broke");
console.log("-".repeat(104));
let totStable = 0, totFiles = 0, totLost = 0, totGained = 0;
for (const t of names) {
  const T = tally[t];
  totStable += T.stable; totFiles += T.files; totLost += T.lost; totGained += T.gained;
  console.log(pad(t, 14) + pad(T.stable + " / " + T.files, 14) + pad(T.lost, 12) + pad(T.gained, 10)
    + (T.detail.slice(0, 2).join("; ") || "—"));
}
console.log("-".repeat(104));
console.log(pad("TOTAL", 14) + pad(totStable + " / " + totFiles, 14) + pad(totLost, 12) + pad(totGained, 10)
  + Math.round(totStable / totFiles * 100) + "% of cases fully intact");
