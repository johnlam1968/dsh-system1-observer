---
name: deploy-a-profile
description: Use when asked to deploy ANOTHER dsh profile to test dsh-system1-observer — "deploy a second profile", "test the observer in a fresh profile", "spin up a profile for testing", "reproduce this stack in a new profile". Points at the task file at the repository root and lists what the acceptance criteria are; the procedure itself lives in deploy/README.md.
---

# Deploying a second profile

**The task is a file at the repository root: `DEPLOY-A-PROFILE.md`.** Read it first. It carries the prompt, the
acceptance criteria, the traps and what is not yet verified.

**The procedure is in `deploy/README.md`**, section *Deploying a SECOND profile, step by step*. It is not repeated
here on purpose: a skill and a task file that each restated the steps would be two copies to disagree.

**The three things this skill exists to make sure you do not skip**, because each was measured as a failure mode:

1. **Give the new profile its own `tracePath`** (`cordis.patch.yml`, mount-bound, so a restart). The default is shared
   with the running profile, and two deployments' readings would land in one file.
2. **Call `system1_explain` in the new profile before configuring it.** It reports the live knobs, the live state, the
   sets it can see and the cautions that make a reading trustworthy — derived from the running row, not from a doc.
3. **Do not edit `deploy/`.** A settings write re-serializes the profile patch, so the recorded copy is re-recorded
   from the live profile afterwards; hand-editing it merges a byte difference that will be mostly formatting.
