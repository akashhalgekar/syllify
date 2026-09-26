# Format probes

These are **synthetic**, not real syllabi. Each one isolates a single formatting
convention so a parser change can be checked against it in isolation:

| File | Convention |
|---|---|
| p1 | `15.10.2025` — dotted day.month.year, standard across continental Europe |
| p2 | `2026-01-20` — ISO dates |
| p3 | "Week of Sep 8" |
| p4 | A schedule table with no "due" word anywhere |
| p5 | Times: `11:59pm`, `noon`, `5 PM`, `17:00`, `9:00 AM` |
| p6 | Tab-separated rows, as pasted out of a PDF or spreadsheet |
| p7 | "by 5pm on Friday of week 3" |
| p8 | Date ranges: `Jun 9-13` |
| p9 | `03/04/2025` — ambiguous numeric, resolved by a later unambiguous date |
| p10 | ALL CAPS tables |

The real, hand-scored corpus is in `../fixtures/`. Run both after any parser change.
