# `human-input-clarity@minimax-1` -- the operator's message, authored by MiniMax-M3

Authored by **MiniMax-M3**, scope `admit`, kept as returned apart from one id that said the opposite of its own
question (`admit_internally_consistent` asked whether the message CONTRADICTS itself, so it is now
`admit_self_contradiction` -- with `true` meaning the message is self-defeating).

It judges the message, never the person: no tone, politeness or satisfaction, and every question is answerable from the
operator's own words.

| question | asks | good is |
|---|---|---|
| `admit_goal_stated` | is an outcome named | goal_stated |
| `admit_target_identifiable` | can the referent be identified without guessing | target_clear |
| `admit_success_criterion_present` | is there a way to judge completion | criterion_present |
| `admit_constraints_given` | are binding constraints stated or clear by default | constraints_explicit |
| `admit_scope_narrow` | how narrow is the work (4 rungs, narrow first) | single concrete action |
| `admit_self_contradiction` | does the message contradict itself | false |
| `admit_actionable_without_clarification` | can an agent start and stop without asking | true |

**A design difference from the set beside it** (`human-input-clarity@1.json`): that one asks whether the message
states what to DO, treats the target as needing to be findable, and classifies common loop hazards. This one is built
from the operator's obligations instead -- goal, target, success criterion, constraints, scope. Two authorings of the
same seam, and the reason to keep both is that they disagree about which failures matter.
