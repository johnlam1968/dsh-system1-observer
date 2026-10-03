# `agent-helpfulness-seams@1` -- what each seam's text must do to be helpful

Companion to [`agent-helpfulness-seams@1.json`](agent-helpfulness-seams@1.json). **The state at a seam is that seam's
own text** (`lib/observe.js`: `state = { hook, text }`), so every question here is answerable from one text with no
conversation beside it -- which is also why none of them names `AGENT RESPONSE` or `TOOL CALLS`. Those belong to the
`turn` and `session` scopes, where the composer emits them.

The two textless seams are absent on purpose: `request` is routing parameters and `close` is `{agent, turn, signal}`,
so the plugin writes a skip line rather than asking a question with no text in it.

| id | seam | asks | good is |
|---|---|---|---|
| `assemble_says_what_to_do` | assemble | does the text direct action rather than describe a situation | yes |
| `assemble_limit_is_explicit` | assemble | is at least one limit or requirement stated | yes |
| `draft_stands_alone` | draft | answerable without the earlier conversation | yes |
| `draft_names_the_output` | draft | both the want and the answer's form are stated | yes |
| `draft_specificity` | draft | how specific the work is | specific |
| `pre_execute_scope_minimal` | pre_execute | limited to what the task needs | yes |
| `pre_execute_arguments_concrete` | pre_execute | concrete values, not placeholders | yes |
| `execute_aims_at_the_request` | execute | aimed at what was asked | yes |
| `post_execute_answers_the_call` | post_execute | carries an answer, not an error or empty value | yes |
| `post_execute_usability` | post_execute | how usable the result is | directly usable |
| `result_keeps_the_specifics` | result | names, numbers and paths survive into the record | yes |
| `result_failure_is_visible` | result | any failure is visible rather than implied | yes |

**Where the human's message is judged** is a different set: `human-input-clarity@1.json`, keyed `admit`, because
helpfulness of the operator is a different question from helpfulness of the agent, and mixing them would make one
number mean two things.

**What this set deliberately does not ask:** anything requiring the conversation (that is the session set), anything
about tone or politeness, and anything that would need a second judgement to interpret (a wide question). Each is one
property of one text.
