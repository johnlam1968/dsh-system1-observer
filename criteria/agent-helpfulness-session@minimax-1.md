# `agent-helpfulness-session@minimax-1` -- whole-conversation helpfulness, authored by MiniMax-M3

Authored by **MiniMax-M3**, scope `session`, kept as returned. Every question names only `SESSION TRANSCRIPT` and
`TOOL CALLS`, which is what that scope composes, so no rewrite was needed.

| question | asks | good is |
|---|---|---|
| `session_opening_served` | does the last AGENT message answer the opening OPERATOR request | true |
| `session_wasted_operator_effort` | how much operator effort went into turns that did not advance the task | few_or_no |
| `session_recovery_after_empty_lookup` | what followed a tool result with nothing usable in it | recovered_with_new_approach |
| `session_scope_creep` | did the final answer stay inside the opening request | stayed_in_scope |
| `session_final_rests_on_tools` | are the final message's factual claims supported by this session's tool results | true |
| `session_stuck_loops` | is repetition without progress visible | no_visible_repetition |
| `session_closing_usable` | does the last message leave something the operator can act on | true |
| `session_clarification_cost` | how much of the agent's work was clarifying questions before an answer | answered_without_clarifying |

**One judgement worth the operator's attention, because it is a value choice rather than a defect:**
`session_clarification_cost` treats "answered_without_clarifying" as the best rung. That is right for a loop whose
operator wants progress, and wrong for one where a wrong guess costs more than a question -- the ladder is MiniMax's
call, and this is where a different deployment would rewrite it.
