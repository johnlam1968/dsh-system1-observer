# Contributing

**What this repository asks of a contributor, and where its own rules live.** The front page of the repository is a
front page: it is for a first-time visitor deciding whether to install this, and it is measured as one. The material
that belongs to someone working ON the project lives here instead.

## The gates, and the order they run in

```bash
npm run ci    # the six gates in order: test, coverage, citations, compat, composition, deploy
```

**Each gate is a question about the repository, and each one has failed before.** The order is not alphabetical and
not a preference: the suite runs first because a red suite stops everything, and the coverage floor runs second
because it is the gate that cannot be argued with once the others have passed. The last two check that what this
repository claims to be is what it is — that its composition matches its own map, and that its published state matches
what the tree says.

**A failing gate is not a nuisance.** It means something is out of place, and the message names where. The gates that
are the most expensive to satisfy are the ones that stop a change nobody measured.

## The rules this repository holds itself to

Each rule, with the measurement that produced it, is in the
[conventions](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/conventions.md).

## A written record

Every defect this project has had is written down, what it cost, and whether it is fixed — the
[register](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/findings.md). It is append-only: a
row is added, never edited, because a record that can be rewritten is not a record.

**Why it is here and not on the front page**: a visitor needs to know the project writes down its mistakes, and a
first screen needs to be about starting. The measured cost of putting the pointer on the front page was **0.11 to
0.18 of internal plumbing** on the `internal_plumbing_present` reading, which is the question that asks whether the
text contains material only someone working on the project would need. The pointer still answers "does this project
write down its mistakes?" — it is one link away, from the section that says how to contribute.

## How a release happens

How a release happens, and what it does not ship, is the maintainer's runbook, and it is kept off-repository with the
other notes. **What a release ships is public and is checkable**: the
[manual](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/manual.md) says which claims are
measured and which are not, and the gates above say whether the tree agrees with itself.

## The standards this front page was written to

The repository's front page is held to a measured standard — what a README must do, where the numbers came from, and
what the instrument cannot tell us — in
[the standards](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/readme-standards.md), with the
worked example in
[the case study](https://github.com/johnlam1968/dsh-system1-observer/blob/master/docs/case-study-readme-review.md).
A change to the front page is measured against that standard, not against taste.
