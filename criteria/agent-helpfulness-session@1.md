# `agent-helpfulness-session@1` -- did this conversation help?

Companion to [`agent-helpfulness-session@1.json`](agent-helpfulness-session@1.json). Scope: **`session`**, the third
state scope. The state is the composed transcript -- `SESSION TRANSCRIPT` (every message, labelled `OPERATOR:` /
`AGENT:`) and `TOOL CALLS` -- requested on demand by `system1_evaluate`, live or from a stored session.

This is the only scope that can ask whether a whole conversation was worth having: a turn judgement sees one exchange,
a seam judgement sees one text.

| id | asks | good is |
|---|---|---|
| `session_request_served` | was the opening request served by the end | yes |
| `session_operator_had_to_repeat` | did the operator have to restate or correct | no |
| `session_failed_tool_recovery` | what followed a lookup that returned nothing usable | retried differently |
| `session_claim_unsupported_by_tools` | is the final answer supported by the tool results | no |
| `session_work_left_to_the_operator` | is work handed back that the agent could have done | no |
| `session_scope_expanded` | did the agent do unrequested work | no |
| `session_context_dropped` | was earlier context forgotten or contradicted | no |
| `session_outcome_reusable` | can the outcome be used as it stands | yes |

**Nothing here needs a number the model does not have**, and nothing asks it to summarise the conversation: the
agent's own summary is evidence *about* the session, not a measurement of it.
