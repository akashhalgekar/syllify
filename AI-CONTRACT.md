# Wiring any model into Syllify

Syllify treats a language model as an untrusted witness. It may propose
deadlines; it may not assert them. This file is the whole contract, so you can
put any model, agent or pipeline on the other end of it.

---

## The shape

**You send** the syllabus as numbered lines, with the instruction below.

**The model returns** a JSON array. One object per deliverable:

```json
[
  { "line": 42, "title": "Problem Set 3", "type": "assignment", "date": "2025-10-14", "time": "23:59" },
  { "line": 51, "title": "Read Solomon Ch. 4", "type": "reading", "date": null, "time": null }
]
```

| Field | Rule |
|---|---|
| `line` | Required. A line number that exists in what you sent. The title must be on that line. |
| `title` | Required. Copied from the line, not rewritten. |
| `type` | `assignment`, `reading` or `exam`. |
| `date` | `YYYY-MM-DD`, or `null`. **`null` is a correct answer.** |
| `time` | `HH:MM` 24-hour, or `null`. |

**Syllify then checks every row** and discards the ones that fail. Nothing
reaches a student's calendar on the model's word alone.

---

## The instruction to send

The page builds this exact prompt. Reproduce it if you are wiring your own:

```
Extract graded deliverables from these numbered syllabus lines.

Reply with ONLY a JSON array of:
{"line":<a number from below>,"title":"<copied from that line>","type":"assignment"|"reading"|"exam","date":"YYYY-MM-DD" or null,"time":"HH:MM" or null}

- "line" must exist below and must contain the title.
- Give a date only if that line states one, or states a session/week number the
  syllabus dates elsewhere. Otherwise null. Never guess a date; null is a correct answer.
- Invent nothing. Copy titles verbatim, do not expand them.

Example: [{"line":42,"title":"Problem Set 3","type":"assignment","date":"2025-10-14","time":"23:59"}]

LINES:
0	MKT 3310 Consumer Behavior
2	Week 2 | Sep 9 | Perception | Reflection paper 1 due Sep 11 by 11:59 PM
…
```

## Keeping the bill down

The student pays for these tokens, so the page sends the fewest that can still
answer the question. Measured across nine real syllabi and two real PDFs, this
takes the average call from about **1,070 input tokens to 550** — a 49% cut with
no loss of candidate lines:

| Rule | Effect |
|---|---|
| Only candidate lines are sent — a line needs a number, or a deliverable, exam or reading word | Policy prose, contact details and boilerplate never cost anything |
| Lines the rules already used are still sent | One row can hold two deliverables; catching the second is why the model is here |
| Lines are truncated at 180 characters, the payload at 7,000 | Caps the worst case without touching a normal syllabus |
| A document whose schedule is an image is skipped entirely | No text to read means no tokens to spend |
| `max_tokens` is 1,600 | A syllabus yields tens of rows, not hundreds, and output is the expensive half |

Lines are tab-separated: number, then text. Send at most about 11,000
characters; beyond that, filter to lines containing digits or deliverable words
and keep the original numbering.

---

## The three checks

Implemented in `parser.mjs` as `verifyProposals(items, lines, { termStart })`.
A proposal is dropped, with the reason recorded, when:

1. **`line` is not a real line.** Out of range, missing, or not an integer.
   → *"cites no real line"*
2. **The title is not on that line.** Words of four or more characters are
   compared against the line's text; none matching means the model attributed it
   somewhere it does not appear.
   → *"does not appear on line 42"*
3. **The date is outside the term.** Three weeks before the term start to
   twenty-four weeks after, when a term start is known.
   → *"date falls outside the term"*

What survives comes back as:

```json
{
  "verified": [
    {
      "title": "Problem Set 3",
      "type": "assignment",
      "date": "2025-10-14",
      "time": "23:59",
      "source_line_number": 42,
      "source_line": "Week 8 | Oct 14 | Indexing | Problem Set 3 due",
      "verified": true
    }
  ],
  "rejected": [{ "title": "Capstone defence", "reason": "cites no real line" }]
}
```

Anything accepted then goes through de-duplication against what the rules
already found, and is displayed labelled **AI** with its source line visible.

---

## What the checks do not catch

Be clear-eyed about this. Verification catches attribution failures — the model
pointing at a line that does not support what it claims. It does **not** catch:

- A **plausible misreading** of a line that really is there. If line 42 says
  "Problem Set 3 assigned" and the model calls it "due", the words are on the
  line and it passes. The evidence label and the visible source line are what
  give a student the chance to notice.
- **Omission.** Nothing can verify a deliverable the model never mentioned. That
  is why the rules run first and independently, why undated items are listed
  rather than dropped, and why the interface states how many lines were read.

Verification makes the model unable to fabricate. It does not make it
comprehensive. Both legs are load-bearing; do not remove either.

---

## When the schedule is a picture

Some syllabi draw their schedule as an image. Text extraction returns nothing for
that page, so text is worthless and the page itself is sent instead.

**This only happens when the text path has already failed** — when the document
looks like a syllabus, has plenty of text, and yields almost no dates. Syllify then
scores each page on whether it announces a schedule and how little text it holds,
takes at most the two best, and renders them to JPEG capped at a 1400px long edge
(about 2,000 tokens a page, and legible enough for a 30-row table).

**Request** adds an `images` array of base64 data URLs:

```
{ "prompt": "<the vision instruction>", "images": ["data:image/jpeg;base64,..."] }
```

The model returns the same shape with two changes: `page` instead of `line`, and a
`row` field quoting the table row it read.

```json
[{ "page": 6, "row": "8 | 15 | 13-Oct | M | Midterm", "title": "Midterm",
   "type": "exam", "date": "2025-10-13", "time": null }]
```

**Verification differs, and is weaker.** There is no text line to check against, so
`verifyProposals` does not apply. Instead: the quoted row must be substantial, the
title's words must appear inside that quote, the page must be one that was actually
sent, and any date must fall inside the term. Rows that survive are labelled
**IMAGE** rather than AI, and the interface tells the student to check them against
the PDF. This is deliberately a weaker guarantee, presented as one.

## Endpoint contract

`worker.js` implements this, but any server that satisfies it will do.

**Request**

```
POST <your endpoint>
content-type: application/json

{ "prompt": "<the instruction and lines above>" }
```

**Response**

```
200 OK
{ "text": "<the model's reply, containing the JSON array>" }
```

The page extracts the array from the first `[` to the last `]`, so a sentence of
preamble is tolerated. A `429` is surfaced to the student as "try again in a
minute"; anything else becomes a plain failure notice with the rules-only results
left intact.

Set `const AI_ENDPOINT = "https://…"` in `index.html` and the pass runs
automatically on every upload. Leave it empty and Syllify falls back to the
viewer's own Claude on claude.ai, or to copy-and-paste anywhere else.
