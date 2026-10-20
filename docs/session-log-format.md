# The session-log format

**What this file is.** The format this repository owns: a stream of records that describes **one conversation**,
written by whatever harness ran it, and readable by any instrument that does not care which harness that was. It is
the answer to a question the operator settled on 2026-10-19: **does this repository own the session-log format, or does
every substrate keep its own?** It owns it.

**Why the question needed answering.** Until then the dsh v4 log was the interchange format by accident — not because
anyone had specified it, but because every importer (pi, the DeepSeek web export, `dsh-chat-import`) happened to
convert *into* a dsh log. A format nobody specified is a format every substrate has to reverse-engineer, and the
evidence of that was in this repository's own findings: the store restated the rules of the rows contract because it
imported no dsh code (**`F177`**, **`F179`**, **`F180`**), and the observer and the store drifted apart on who spoke
(**`F173`**), on the digest (**`F174`**) and on the text of a message. **A format that is only ever implemented once
has never been a format; it has been a private convention that happened to be readable.**

**The reference implementation is the dsh v4 log.** Nothing is renamed. The record names below are the names the
harness already writes and the names every importer already produces, and they are neutral enough to keep: a record
says `user/message`, not `dsh/message`. **The format is the SHAPE and the RULES; the dsh log is one implementation of
them; a pi log is another.** The two differ in what they can express — pi has no turn, and the corpus says so — and
the rules below are what they must agree on.

**How to read the numbers.** Every claim here is measured on the live corpus on the operator's machine: **946
sessions**, 10,698 `user/message` records, 81,377 `assistant/message` records, 84,591 tool calls. The measurements
are dated 2026-10-19 and the corpus is the one at `~/.dsh/sessions`.

---

## 1. The record stream

A session log is **JSONL**: one JSON object per line, in the order things happened, with a trailing newline. It may be
compressed (`.zstd`); **the compressed and the decoded bytes are different lengths, and a receipt must name the
decoded one** — that is `sessions.decoded_bytes` in the index, and it is a rule below rather than an accident.

The **first line is the header** and it is a record, not a payload: `{"type": "session", "version": 4, "id": …,
"createdAt": …, "cwd": …}`. `cwd` and `createdAt` sit at the **top level**, and a reader that looks for them inside
`data` finds none of them — measured on 498 real sessions, that mistake indexed **0 of 498** cwds. A header may also
carry `parentSession`, `origin`, `delegationDepth`, `agentPreset` and `isSeeded`, and a session may name its own title
in a later `session/title` record.

## 2. The records

| record | carries | notes |
|---|---|---|
| `session` | the header above | the first line |
| `user/message` | `data.source.kind`, `data.content` | **the source kind is what says who spoke** — the record type does not (§4) |
| `assistant/message` | `data.message.content`, `data.turn?`, `data.interrupted?` | the text is at `data.message.content`, one level deeper than a user message |
| `tool/call` | `data.callId`, `data.name`, `data.arguments` | **not a message**: it is evidence, and folding it into a message makes tool traffic indistinguishable from something the model said |
| `tool/result` | `data.message.content`, and the call id in **two** places | a result's id lives in `data.callId` and in `data.message.toolCallId`, and pairing on one alone leaves results matched by position |
| `turn/start`, `turn/end`, `step/start`, `step/end` | the harness's own boundaries | **optional for a substrate** — pi has no turn at all |
| `session/title` | `data.title`, `data.source`, `data.messageSeqs` | a title's provenance is part of the title |

**A MESSAGE'S CONTENT IS AN ARRAY OF BLOCKS**, and the block type is the whole of the meaning:

| block | measured count | what it is |
|---|---|---|
| `text` | 125,298 | the model's visible words |
| `tool-call` | 84,592 | a call the model made, inside the message that made it |
| `reasoning` | 45,820 | the model's thinking — **never text, never shown to the judge** |
| `tool-result` | 16,634 | a result that came back inside the message |
| `tool-addition` / `tool-removal` | 316 / 150 | the model's tool set changed |
| `image` | 18 | a picture |

**A REASONING BLOCK IS NOT A TEXT BLOCK.** The harness's own `ContentBlockMap` declares `'text': TextBlock` as
`{ type: 'text'; text: string }` and `ReasoningBlock` carries a `text` field too, so a reader that takes `.text`
from *any* block hands the model its own reasoning as though the operator had typed it. **Only a block whose `type` is
`text` is text** (rule 6).

## 3. The rules

Every one of these was bought by a measurement, and every one of them is enforced — by the rows contract
(`core/session-rows.js`) on the way out, and by the index builder on the way in.

1. **A message's text is trimmed.** The observer's producer trimmed it and the store's did not, so one message had two
   texts — 58 characters in one channel, 59 in the other, the difference being a trailing space — and **53 of the 946
   sessions** in the corpus differ that way (**`F177`**). The `stateHash` of a measurement is made of the text, so
   those were two readings of one conversation.
2. **A row carries no NUL byte.** `node:sqlite` binds a string with NUL-terminated semantics, so a message whose text
   held one NUL was stored as the characters before it and **nothing after it**: 67 messages in one session were 11
   characters in the index and 100 in the log, and two tool-call names became empty strings (**`F180`**). **U+FFFD**
   is the replacement — it keeps the length, so a marked text is the same measurement and not a shorter one.
3. **`interrupted` is present, and its absence is `null`.** `false` is a claim ("this message was not interrupted")
   from a producer that never looked: reading the field as `=== true` answered `false` for **278 of 282** messages
   that never mentioned it (**`F181`**). The corpus has **122** messages that really were interrupted, and a channel
   that cannot say so says `null`.
4. **`source.kind` is required, and exactly one kind means a person.** Measured: **10,698** `user/message` records and
   **zero** without a source — the harness refuses a log that does not declare one, so a substrate that omits it
   produces a log nothing can read. The kind is the only thing that separates a person from the harness, and the
   harness speaks on the same channel (§4).
5. **A compaction withdraws a span, and the withdrawal is in the log.** A `surfaceOp` of `{op: 'replace', startSeq,
   endSeq}` names a range of records the model **cannot see** — 3,417 such messages in one session, and 178,234
   `surfaceOp` records across the corpus. A reader that ignores it measures text nobody could read, while looking
   complete. The rows contract calls this `shadowed`, and it is required.
6. **Only a `text` block is text; reasoning is reasoning.** The judge has never been given the reasoning, and folding
   it in now would change what every reading means. Whoever gives reasoning to the judge decides that, once, in one
   place.
7. **Absence is `null`, never `''` and never `0`.** There is no reasoning is not zero-length reasoning, and a missing
   exchange is not exchange zero.
8. **The receipt names the bytes that were read**: the **decoded** length, the digest of the **decoded** bytes, and
   the last record reached. The compressed and the decoded lengths are different facts under one name, and a receipt
   that means two things cannot be compared with another receipt (**`F182`**).

## 4. The content kinds, measured

A `user/message` carries `data.source.kind`, and the kind is the content axis. Measured over the corpus:

| kind | count | who it is |
|---|---:|---|
| `user` | 6,495 | **a person** — the only kind that means a human |
| `skill-catalog` | 691 | the harness |
| `runtime-context` | 689 | the harness |
| `agent-instructions` | 648 | the harness |
| `goal` | 604 | the harness |
| `agent-message` | 287 | the harness |
| `docdrift` | 262 | the harness (a profile speaking) |
| `plugin` | 248 | the harness |
| `subagent-settled` | 228 | the harness |
| `tool-jobs` | 106 | the harness |
| `pi-subagent-notify` | 74 | a substrate's own kind |
| `compact-checkpoint` | 70 | the harness |
| `user-approval` | 46 | the harness |
| `pi-goal-event` | 34 | a substrate's own kind |
| … 16 more, each under 30 | | |

**THE RULE THE TABLE GIVES: exactly ONE kind means a person, and the set is OPEN.** Ten of the kinds above are pi's
own, and that is the point: a substrate may name its own kinds, because a kind is a statement about **who produced
this text**, and a pi session has facts a dsh session does not (a telegram connection state, an intercom message, a
slash-command result). What the format fixes is the ONE distinguished kind — the human — and the requirement that
every record declare one.

**WHY IT MATTERS MORE THAN IT LOOKS.** The harness speaks on the user channel, so counting the record TYPE as if it
counted the person inflated the ask count by **86.8%** — 753 `user/message` records, 403 of them the human and 350 the
harness — and every injection opened an ask-group of its own, and the judge was handed skill catalogues as though the
operator had typed them (**`F173`**). **A kind is not a label; it is the difference between a question and an
instruction.**

## 5. The acts, measured

What the agent DID, as opposed to who spoke. The content blocks carry it, and the counts are the corpus's:

| act | count | where it lives |
|---|---:|---|
| said something | 125,298 | a `text` block |
| called a tool | 84,592 | a `tool-call` block, and 84,591 `tool/call` records |
| thought something | 45,820 | a `reasoning` block |
| took a result back | 16,634 | a `tool-result` block, and 85,222 `tool/result` records |
| changed its tool set | 466 | `tool-addition` (316) and `tool-removal` (150) |
| saw a picture | 18 | an `image` block |

**THE ACT LAYER IS NOT YET A CONTRACT, and this file says so rather than pretending.** What is fixed is that the acts
exist, that they are separate from the kinds, and that reasoning is not text. What is not fixed is the vocabulary an
instrument should use to *ask about* them — "what did the agent do" is one question and "what did it say, and what did
it call" are others, and no measurement in this repository has needed to tell them apart yet. **The act layer is
deliberately undecided, and the honest reason is that no consumer has asked for it.**

## 6. What a new substrate must provide

The checklist, for pi or for anything else:

1. **A header record** with `id`, `createdAt` and `cwd` at the **top level** (§1).
2. **Messages as blocks**, with `text` and `reasoning` as separate block types, and **no `thinking`** — pi's
   `thinking` is renamed to `reasoning` on the way in, and accepting both is a second way to read one vocabulary
   (**`F179`**).
3. **A `source.kind` on every `user/message`**, and the human's kind is `user`.
4. **A `surfaceOp` on anything that withdraws earlier records**, if the substrate has such a thing.
5. **`interrupted` stated when it happened, and absent otherwise** — never `false` by default.
6. **The rules of §3**, in particular trimmed text and no NUL byte, which are the two a naive writer gets wrong.
7. **Nothing else.** A substrate does not have to write turns, and **must not invent them**: the ask-group is derived
   from the human's messages, because a turn is a dsh-shaped boundary and a substrate without turns would otherwise
   read as a dsh-only query.

**AND THEN: the substrate's log is read by a producer that writes the rows contract.** The rows are the instrument's
input, and they are the same rows for every substrate — that is the whole point of them, and the contract is what
holds them to it.

## 7. What this file is not

**It is not the harness's format.** The dsh v4 log has fields this file does not mention (a turn, a step, a stream of
deltas, usage counters), and it will have more. The format is the **floor**: what a log must carry for a measurement
to be reproducible and for two channels to be comparable.

**It is not a selection.** *Which* records a measurement looks at is the instrument's business — the human's asks
rather than the harness's injections, the surface rather than the log. The format says what a record IS; the
instrument says what to do with it. That separation is why a session-handling plugin can be replaced without touching
the measurement.

**It is not the rows contract**, which is a different thing with a different job: the rows are what an instrument
consumes, and the contract is the seven rules a producer of rows obeys. The two overlap — §3 is where they meet — and
they are kept apart so that the format can be implemented by a substrate that never produces rows.

## 8. Where the rules are enforced

| rule | enforced by |
|---|---|
| trimmed text, no NUL, `interrupted` present, absence is `null` | `core/session-rows.js` (`validateRows`) — the contract, on the way out |
| the source kind | `dsh/session-adapter/lib/session-format.js` (`isHumanMessage`) — the vocabulary |
| no NUL on the way in | `dsh-session-index`'s `blockText` — the store's own copy of the rule, until the shared half is a package |
| trimmed text on the way in | the same `blockText`, and the index reader trims again so a stale index cannot break the contract |
| the two channels agree | `scripts/check-channel-agreement.mjs`, over the whole corpus — **946 of 946 sessions agree on every field today** |

**The duplication in that table is the next piece of work, and it is now decided:** the shared half becomes a
published package that owns the contract, with a conformance fixture both repositories test against, so that a change
to one side is a change to the other by construction rather than by discipline.
