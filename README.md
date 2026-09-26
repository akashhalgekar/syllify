# Syllify

**→ [akashhalgekar.github.io/syllify](https://akashhalgekar.github.io/syllify/)**

Drop in every syllabus you were handed. Get every deadline, traced to the line it
came from, and the whole term on your calendar.

**No account. No upload. No server.** Everything runs in the browser tab — PDF text
extraction, every parsing rule, the calendar file. With no AI key configured the page
makes no network requests at all.

Built from an ISE 588 concept (USC Viterbi) into a working tool. MIT licensed.

---

## Run it yourself

Three ways, none of which need a build step.

```bash
git clone https://github.com/akashhalgekar/syllify.git
cd syllify
node serve.mjs            # http://localhost:8080
```

Or **double-click `index.html`** — everything works except that browsers restrict web
workers on `file://`, which makes PDF reading slower.

Or **deploy your own**: it is static files, so GitHub Pages (Settings → Pages → deploy
from `main`, `/root`), Netlify drop, or Cloudflare Pages all work with nothing to
configure. Deploy the whole folder and not just `index.html` — `vendor/` has to come
with it, or PDF reading and the fonts break.

---

## The AI pass is optional, and you bring your own key

Syllify's rules do the work on their own. The AI pass is a second reader for what the
rules missed, and the only way to read a schedule that was saved as an image.

There is no shared key in this repository and no Syllify server. Click **AI off** in
the header, pick a provider, paste your own key. It is stored in your browser's
localStorage, sent to the provider you chose, and nowhere else.

| Provider | Default model | Reads images |
|---|---|---|
| Anthropic | `claude-haiku-4-5-20251001` | yes |
| OpenAI | `gpt-4o-mini` | yes |
| Google Gemini | `gemini-2.0-flash` | yes |
| Groq | `llama-3.3-70b-versatile` | no |
| OpenRouter | `anthropic/claude-3.5-haiku` | yes |

**Cost:** about 550 input tokens per syllabus, or ~2,000 for a page read as an image.
Fractions of a cent.

**If a provider refuses direct browser calls**, or you want to run this for a class
without handing out keys, deploy `worker.js` (a Cloudflare Worker, five minutes, no
command line — the setup is in the file's header comment) and paste its URL into the
same panel instead. The key then lives on the Worker rather than in anyone's browser.

**Security, stated plainly:** anyone with access to a browser can read a key stored in
it. Use a key with a spending limit, and prefer the Worker for anything shared.

---

## The promise, stated exactly

Syllify does **not** promise to find every deadline in every syllabus. No parser does,
and anything claiming otherwise is lying to you.

It promises two things instead, and `test.mjs` checks both:

1. **Everything it shows you traces back to your document.** Every deadline carries the
   line number and the exact text it was read from.
2. **Nothing a model proposes is shown unless it checks out.** An AI item must cite a
   line that exists, its title's words must appear on that line, and any date must sit
   inside the term. Fabrications are rejected with the reason displayed.

And three behaviours that follow:

- A syllabus dated only by **session or teaching week** produces *no dates at all* until
  you supply your first class date. It does not guess.
- Deliverables it recognised but could not date are **listed**, not dropped.
- A file that does not look like a syllabus is **flagged**, not parsed into deadlines.
  A resume scores 2 out of 9 and says so.

Rows read from an image are labelled **IMAGE**, not AI, because a picture has no text
line to verify against. That is a weaker guarantee and it is presented as one.

---

## Verify it yourself

```bash
node test.mjs      # 24 guarantee tests
node mutate.mjs    # 60-case robustness matrix, 10 format transformations
```

Measured on 9 real syllabi from 7 institutions, 127 deadlines scored by hand:
**121 accounted for, 0 invented.** 92% of cases survive a format change intact.
`fixtures/` is the corpus; `probes/` isolates single formatting conventions.

---

## What it handles, and what it does not

**Handled well**

- Dated schedule tables, including multi-column PDF layouts
- Week grids where the date sits in a different cell from the deliverable
- Session, class, lecture and module numbering, with a first-class-date prompt
- Teaching-week numbering, self-calibrating when any row pairs a week with a date
- Prose lists, abbreviations, and rescheduled deadlines ("now due …")
- Relative rules such as "due six days after the session"
- Date ranges, anchored to the start and flagged
- Break weeks announced in the text, which push later sessions back
- Day-first and month-first numeric dates, inferred from the document, with a
  manual switch when nothing settles it
- Month names in Spanish, French, German and Italian

**Not handled**

- **Scanned PDFs.** No text layer. With an AI endpoint configured, a schedule saved
  as an image is rendered and read by a vision model, labelled `IMAGE`; without one,
  paste the text instead.
- Syllabi numbered by a bare column (`LEC #` with no word "session")
- Deadlines expressed as "noon Wednesday of Week 11"
- Titles from wrapped PDF table cells bleed across columns — numbers, dates and
  times are right; labels can be rough
- Confidence bands are honest but not calibrated. Calibrating them needs 50–100
  hand-keyed syllabi.

Tested against eleven real syllabi from nine institutions in four countries,
plus deliberate non-syllabus controls. The full research write-up and a protocol
for testing with students is in the project notes.

---

## Privacy

Without a Worker configured the page makes **no network requests at all** — not
to a server, not to a CDN, not to a font host. pdf.js and the fonts ship in
`vendor/`. Everything runs in the tab: no account, no upload, no analytics, no
cookies. Pull the ethernet cable and it still works.

With a Worker: the extracted text of the syllabus is sent to your chosen model
when the AI pass runs. Nothing else changes.
