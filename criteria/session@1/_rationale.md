# `session@1` -- the default measurement, both dimensions

This is the set a session measurement asks when nobody names another: EIGHT questions about the AGENT and EIGHT about
the OPERATOR, so one call returns both dimensions of a conversation rather than half of it.

Built 2026-10-04 by merging `agent-helpfulness-session@1` (the agent dimension, hash `db06d2a49ed6`) with
`human-conduct-session@1` (the operator dimension, hash `fb7d70a3faa8`). Hash of this composition: **`49564c8cb0a8`**.
Eight operator-side questions arrived through `human-conduct-session@1`; the agent side here is the composition that
was validated against a battery.

## Why MiniMax-M3's set is NOT concatenated into it

`agent-helpfulness-session@minimax-1` asks the SAME EIGHT DIMENSIONS in different words:

| this set | MiniMax-M3's set |
|---|---|
| `session_request_served` | `session_opening_served` |
| `session_operator_had_to_repeat` + `session_work_left_to_the_operator` | `session_wasted_operator_effort` + `session_clarification_cost` |
| `session_failed_tool_recovery` | `session_recovery_after_empty_lookup` |
| `session_scope_expanded` | `session_scope_creep` |
| `session_context_dropped` | `session_clarification_cost` |
| `session_outcome_reusable` | `session_closing_usable` |
| `session_claim_unsupported_by_tools` | `session_final_rests_on_tools` |
| -- | `session_stuck_loops` |

Concatenating them would ask one dimension TWICE under two names and double the judge calls to say the same thing
twice. So the merge is one dimension per side, and MiniMax-M3's set stays loadable in its own right:

    system1_evaluate_session { sessionId, set: 'agent-helpfulness-session@minimax-1', segmentChars: 57600, package: true }

**An agent should load whatever set it sees fit.** `system1_question_sets { action: 'list' }` shows what exists,
`action: 'read'` shows one, and `set:` names it for a call -- no settings change, no row edit. The two differences
that matter when choosing: the sets here have been scored against known-answer batteries and MiniMax-M3's has not, and
`session_stuck_loops` is a dimension this set does not ask at all, so a session suspected of looping should be
measured with that set or with both.
