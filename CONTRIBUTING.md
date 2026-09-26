# Contributing

The most useful contribution is **a syllabus that breaks it.**

## Adding a syllabus to the test corpus

1. Save the schedule as plain text in `fixtures/` (strip anything identifying).
2. Run `node test.mjs`. If it still passes, work out what the parser got wrong by hand.
3. Open an issue with the file and what should have come out.

Six real syllabi from six real students are worth more than sixty found on the web,
because they are the actual distribution of the documents this has to survive.

## Changing the parser

Every change must clear three gates before it ships:

```
node test.mjs        # 24 guarantee tests — traceability, AI verification, no invented dates
node mutate.mjs      # 60-case robustness matrix across 10 format transformations
```

and the nine files in `fixtures/` must produce **identical counts** to before, unless
you are deliberately fixing one of them. A parser change that silently alters a real
syllabus is a regression even when the new number looks better.

## The rule that matters

Syllify does not invent dates, and it does not hide what it missed. Any change that
makes the product more confident without making it more correct will be declined,
however much it improves the numbers.
