# `agent-helpfulness-seams@minimax-1` -- per-seam helpfulness, authored by MiniMax-M3

Authored by **MiniMax-M3** at the operator's request, for the seven text-carrying seams, and adjudicated by the
observer's author against the one thing a loader cannot check: **whether each question can be answered from the state
the call actually carries.** At a seam that state is `{hook, text}` -- that seam's text, with no conversation beside it.

## What was changed, and why

| id as returned | id now | why |
|---|---|---|
| `assemble_prompt_grounded_in_state` | `assemble_prompt_is_concrete` | it asked about "specifics from the surrounding state", and at `assemble` there is no surrounding state -- only the text being composed |
| `draft_matches_request` | `draft_states_a_checkable_goal` | "address what the operator asked" needs the operator's ask, which the `draft` state does not carry |
| `pre_execute_call_appropriate` | `pre_execute_arguments_match_tool` | "appropriate for what is being attempted" needs the attempt; the arguments and the tool are what the text shows |
| `execute_call_targets_intended_resource` | `execute_target_is_explicit` | "the resource the surrounding context indicates" -- there is no context in the state |

The rewrites keep the authored intent and move the question onto text the call actually contains. Nothing else was
touched: the ladders, the option labels, the abstain options and the ids of the other ten questions are MiniMax's.

**A field it uses that the template did not document:** `noul` specs here carry `criteria: {"true": ..., "false": ...}`,
which `lib/questions.js` passes to `noul()` and the loader accepts. It is now in the template.

**Overlap to note:** this set includes two `admit` questions, which is also the scope of `human-input-clarity@*.json`.
That is deliberate in the file as authored, and it means a merge of the two must let one set own `admit`.

| seam | question | good is |
|---|---|---|
| assemble | `assemble_prompt_focused_on_task` | task_focused |
| assemble | `assemble_prompt_is_concrete` | names_concrete_specifics |
| admit | `admit_request_understood` | clear_and_specific |
| admit | `admit_request_in_scope` | true (a substantive request) |
| draft | `draft_states_a_checkable_goal` | checkable_goal |
| draft | `draft_concise` | true |
| pre_execute | `pre_execute_arguments_match_tool` | arguments_match |
| pre_execute | `pre_execute_call_well_formed` | specific_and_well_typed |
| execute | `execute_call_safe` | reversible_or_read_only |
| execute | `execute_target_is_explicit` | true |
| post_execute | `post_execute_result_usable` | complete_and_usable |
| post_execute | `post_execute_result_indicates_failure` | success |
| result | `result_record_grounded` | true |
| result | `result_record_summarises_usefully` | useful_summary |

`execute_call_safe` is the set's most useful addition over the set authored beside it: it asks whether the call could
do irreversible damage, which is a property of the call text alone and therefore answerable at that seam.
