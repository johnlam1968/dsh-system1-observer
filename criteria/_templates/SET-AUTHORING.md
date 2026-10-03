# Authoring a question set

A set is a JSON file in `criteria/`, selected by name (`questionSet`), and identified by the **hash of its bytes** --
so any edit is a new instrument and the runs before and after it are honestly incomparable.

## The one rule that decides whether a set is usable

**A question may only name state the composer actually emits for that scope.** A question that references a section
the call does not carry is not a hard question; it is an unanswerable one, and the model will still answer it.

| scope (`questions` key) | what the state is | what you may name |
|---|---|---|
| a seam: `assemble` `admit` `draft` `pre_execute` `execute` `post_execute` `result` | **that seam's own text only** (`{hook, text}`) | nothing by name -- the text IS the subject. Do not write "AGENT RESPONSE" here |
| `turn` | the composed exchange | `OPERATOR REQUEST`, `AGENT RESPONSE`, `TOOL CALLS`, `OPERATOR NEXT MESSAGE` |
| `session` | the composed transcript | `SESSION TRANSCRIPT`, `TOOL CALLS` |

`request` and `close` carry **no text at all**, so nothing can be asked at them. A set that names them is a set with an
empty list.

## The shape of a spec

```json
{ "id": "draft_stands_alone", "type": "noul",
  "instructions": "Could a competent reader answer this request from the text alone?" }
```

- `noul` -- a yes/no predicate. One question, one property. It may carry an explicit reading of each answer:
  `"criteria": {"true": "...", "false": "..."}`, which the loader passes through to `noul()` -- useful when the id alone
  does not make the polarity obvious.
- `score` -- an ordinal ladder, `levels` from worst to best, 3 levels is usually enough. The levels are what make it
  calibratable: a score without a stated ladder is a noul wearing a number.
- `choice` -- a closed list of `{label, criterion}`. **EXACTLY ONE option must carry `"abstain": true`** (the loader
  refuses the set otherwise, and the refusal names the question). The abstain option is "cannot tell / none of these",
  not a substantive answer.

**Every judgement is ONE narrow question.** No question asks the model to summarise, infer intent, or characterise in
prose -- that is several questions sharing an id, and it cannot be calibrated. State the polarity: which answer means
the agent was MORE helpful.

## Naming and versioning

- File: `<what it judges>-<scope>@<n>.json`, e.g. `agent-helpfulness-seams@1.json`.
- Ids: `<scope>_<property>`, lowercase, stable once published -- an id is how a line's answer is read back.
- A revision is a NEW FILE (`@2`), never an edit in place if the old hash is already in a trace.
- The rationale: `<set>.md` beside it, saying what each question detects, its polarity, which state it needs, and why
  it is not too wide.

## Verify before you commit

```bash
node --input-type=module -e "
import { readSelectedSet } from './lib/question-sets.js'
import { buildQuestions } from './lib/questions.js'
const sel = readSelectedSet('criteria', 'YOUR-SET-NAME')
for (const seam of Object.keys(sel.questions)) {
  const built = buildQuestions({ questions: sel.questions }, seam)
  console.log(seam, Object.keys(built.questions).length, built.problems)
}"
```

**A set with problems is not a set.** The loader drops it and the row REFUSES the call rather than asking something
else, so `problems: []` for every scope is the bar.
