# What a repository README must do — the standards, and the questions derived from them

Collected 2026-10-06, from the sources themselves rather than from memory, to answer one question with a measurement
instead of an opinion: **is this repository's README suitable as the front page of the repository?**

## The sources

| source | what it is | what it requires |
|---|---|---|
| [Standard Readme](https://github.com/RichardLitt/standard-readme/blob/master/spec.md) | a specification, "designed for open source libraries" | named sections in order (Title, Short Description, Install, Usage, Contributing, License…), Title/Short Description/Install/Usage/Contributing/License **required**; short description under 120 characters and on one line; a table of contents for anything over 100 lines; **"must not contain broken links"**; License last |
| [GitHub Docs — About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) | the platform's own guidance | a README "typically includes": what the project does, why it is useful, how to get started, where to get help, who maintains it. **"A README should only contain information necessary for developers to get started using and contributing to your project. Longer documentation is best suited for wikis."** Content beyond 500 KiB is truncated; GitHub generates a table of contents from the headings itself |
| [opensource.guide — Starting an Open Source Project](https://opensource.guide/starting-a-project/) | GitHub's open-source handbook | a README should answer *what does this do*, *why is it useful*, *how do I get started*, *where can I get help*; "remember that your readers aren't you"; write down when the project is not ready for production; the pre-launch list names LICENSE, README, CONTRIBUTING and CODE_OF_CONDUCT |
| [CSC207 "Have I Made a Good README?"](http://www.cs.toronto.edu/~calver/acceu/checklists/ReadmeChecklist.pdf) and [CSC290 Repository Grading Rubric](https://www.cs.toronto.edu/~lczhang/csc290_20191/files/repository_rubric.pdf) | university **evaluation** checklists, i.e. rubrics rather than advice | identified and cited; **not read** — both are PDFs this environment cannot fetch, so nothing here is attributed to them |

**What the sources do NOT settle**, and the conflict that matters for this repository: Standard Readme assumes the
README carries the project's reference material (it requires an `API` section and a table of contents for over 100
lines), while GitHub says in as many words that the README is for *getting started* and long documentation belongs
elsewhere. Both cannot be satisfied by one document at 775 lines.

## The questions derived from them, and whether a judge can answer them

The judge receives **only the text**. A criterion it cannot check is not a question, so each row says what the judge
can see. `noul` questions return a probability that the statement is true; the `score` questions grade; the `choice`
question decides which audience the document is written for — the diagnosis the operator's complaint is about.

| id | type | what the judge is asked | source | checkable from text? |
|---|---|---|---|---|
| `primary_audience` | choice | who this text primarily addresses: a first-time visitor deciding whether to install it · a contributor working on the repository · an operator or agent already running it · an unclear mix · cannot tell | GitHub, opensource.guide | yes |
| `states_what_it_is` | noul | the opening says what the project IS, in plain terms, before history or internal reasoning | GitHub ("what the project does") | yes |
| `states_why_useful` | noul | it says why the project is useful, or what a user can do with it | opensource.guide ("why is this useful") | yes |
| `install_present` | noul | a new user can copy an install command out of the text | Standard Readme (Install required) | yes |
| `usage_example_present` | noul | at least one concrete usage example (a command or a short call sequence) appears | Standard Readme (Usage required) | yes |
| `licence_stated` | noul | the licence is stated by name or SPDX identifier | Standard Readme (License required, last), opensource.guide | yes |
| `help_or_contributing_path` | noul | it says how to contribute, or where to ask for help | Standard Readme (Contributing required), opensource.guide | yes |
| `getting_started_scope` | noul | the text confines itself to what a developer needs to GET STARTED, leaving long-form documentation elsewhere | GitHub ("only … necessary … to get started") | yes |
| `internal_plumbing_present` | noul | it contains passages that only make sense to someone working ON the project — CI configuration, gate names, coverage floors, defect-register or issue-row references | GitHub (the same sentence, read the other way) | yes |
| `first_screen_sufficient` | noul | a reader of the first screen alone can tell what the project is and how to begin | GitHub ("often the first item a visitor will see"), opensource.guide ("your readers aren't you") | yes — *if* the given text is the first screen, which is how it must be presented |
| `audience_fit` | score | how well the text serves a first-time visitor deciding whether to use the project (`mismatched` · `weak` · `adequate` · `good` · `exact`) | GitHub, opensource.guide | yes |
| `front_page_quality` | score | overall quality of this text AS a repository front page (`unusable` · `poor` · `adequate` · `good` · `exemplary`) | all three | yes |

## How they are used, and why not as a stored set

`system1_decide { state, questions }` takes the specs inline — "the same shape the observer is configured with, so a
set file can be passed as it is written". **A stored set cannot hold them**: every set this plugin loads declares a
scope, and the writable scopes are the nine seams, `turn` and `session` — a repository README is none of those. So a
document-evaluation instrument is passed per call, and this file is where its questions live, with their sources.

```json
[
  { "id": "primary_audience", "type": "choice", "instructions": "Who does this text primarily address?",
    "options": [
      { "label": "a_first_time_visitor", "criterion": "a developer deciding whether to install and use the project" },
      { "label": "a_contributor", "criterion": "someone working on the repository itself" },
      { "label": "an_operator", "criterion": "someone already running it, or an agent maintaining it" },
      { "label": "unclear_mix", "criterion": "no single audience: the text changes audience as it goes" },
      { "label": "cannot_tell", "criterion": "the text does not reveal who it is for", "abstain": true }
    ] },
  { "id": "states_what_it_is", "type": "noul", "instructions": "The opening says what the project IS, in plain terms, before any history or internal reasoning." },
  { "id": "states_why_useful", "type": "noul", "instructions": "The text says why the project is useful, or what a user can do with it." },
  { "id": "install_present", "type": "noul", "instructions": "A new user could copy an install command out of this text and run it." },
  { "id": "usage_example_present", "type": "noul", "instructions": "At least one concrete usage example appears: a command, or a short sequence of calls." },
  { "id": "licence_stated", "type": "noul", "instructions": "The licence is stated by name or by an SPDX identifier." },
  { "id": "help_or_contributing_path", "type": "noul", "instructions": "The text says how to contribute, or where to ask for help." },
  { "id": "getting_started_scope", "type": "noul", "instructions": "The text confines itself to what a developer needs in order to GET STARTED, leaving long-form documentation to live elsewhere." },
  { "id": "internal_plumbing_present", "type": "noul", "instructions": "The text contains passages that only make sense to someone working ON the project: CI configuration, internal gate names, coverage floors, or references to a defect register or issue rows." },
  { "id": "first_screen_sufficient", "type": "noul", "instructions": "The text you were given IS the first screen a visitor sees, and reading only it tells them what the project is and how to begin." },
  { "id": "audience_fit", "type": "score", "instructions": "How well does this text serve a first-time visitor deciding whether to use the project?", "levels": ["mismatched", "weak", "adequate", "good", "exact"] },
  { "id": "front_page_quality", "type": "score", "instructions": "Overall, how good is this text AS the front page of the repository?", "levels": ["unusable", "poor", "adequate", "good", "exemplary"] }
]
```

## The measurement, 2026-10-06

The two candidates, judged with the twelve questions above by `typesafe/jev-1.13-20260917` (the revision is named
because the alias is not the fact). **State A** is the first 68 lines of `README.md` — the front page as a visitor
meets it, ending at the CI/coverage-floor passage the operator objected to. **State B** is `docs/npm-readme.md`, the
proposed landing page, judged twice: once as first written, and again after the measurement found two gaps in it.

| question | A: the manual's front page | B: landing page, first | B: after the fixes |
|---|---|---|---|
| `primary_audience` | **a_contributor 0.57** | a_first_time_visitor 0.90 | **a_first_time_visitor 0.94** |
| `install_present` | **0.13** | 0.76 | not re-asked |
| `help_or_contributing_path` | **0.08** | 0.11 | **0.99** |
| `getting_started_scope` | **0.34** | 0.90 | not re-asked |
| `internal_plumbing_present` | **0.97** | 0.75 | **0.35** |
| `first_screen_sufficient` | 0.65 | 0.80 | not re-asked |
| `states_what_it_is` | 0.89 | 0.91 | not re-asked |
| `states_why_useful` | 0.88 | 0.97 | not re-asked |
| `usage_example_present` | 0.94 | 0.99 | not re-asked |
| `licence_stated` | 0.95 | 0.95 | not re-asked |
| `audience_fit` (of 4) | **1.91** | 3.10 | **3.22** |
| `front_page_quality` (of 4) | **unreadable, twice** | 3.11 | **3.26** |

**What it decided.** The operator's complaint is now a measurement rather than an opinion: the current front page
reads as **a contributor document** (0.57 against 0.27 for a first-time visitor), carries internal plumbing at
**0.97**, offers **no install command** (0.13) and **no way to ask for help** (0.08), and grades **1.91 of 4** for the
audience GitHub and opensource.guide describe. The landing page flips every one of those, and the two questions that
stayed weak in it — a help path at 0.11 and internals at 0.75 — were FIXED and re-measured, not argued away.

**What it found that neither of us had noticed**: the landing page's cautions were written in the project's own
vocabulary ("seams", "the probe", "a question set"), which is why internals still read at 0.75 for a first-time
visitor. Rewriting them in the reader's terms (and adding an issues link) moved that to 0.35 and the help path to
0.99 — a defect the review's prose had not identified and the judge did.

### What the measurement responds to: content, not section names

The reviewer asked which part of the fix moved `help_or_contributing_path` from 0.11 to 0.99 — the sentence, or a
section named as Standard Readme requires. **Measured by ablation**: the same page with ONLY the
"Questions, and contributing" paragraph and its issues link removed scores **0.10**, and restored **0.99**. The
heading in both cases is *"Questions, and contributing"* — never Standard Readme's required `Contributing`.

Two more data points point the same way: `usage_example_present` scores **0.94–0.99** under a heading called
*"Sixty seconds"*, not `Usage`; and `install_present` scores **0.76** under a heading that DOES say `Install`,
so the heading did not carry it. The judge is reading what the text tells a reader, not which spec section it filed
it under.

**And that has a consequence for the divergence above**: a strict specification and this judge are measuring
different things — form against intelligibility — so Standard Readme conformance cannot be inferred from these
figures in either direction. What the ablation does show is that a single sentence and a link are enough for the
question to separate, which is the sensitivity a usable instrument needs.

### The second before/after, and three cautions from the instrument's own guidance

`install_present` scored **0.76** with a `## Install` heading and `dsh plugin --profile <profile> add …`. The
suspected cost was the placeholder a reader cannot substitute; the fix was a concrete command (`--profile web`) and
one sentence. **Re-measured: 0.91.** Together with the help-path ablation (0.10 → 0.99) this is what a usable
question looks like: one line of text moves it by a large, repeatable margin.

Three cautions, checked against this instrument's documented behaviour AFTER the measurement — two of which the
figures had hidden:

1. **The pair `getting_started_scope` / `internal_plumbing_present` is near-complementary, so neither number
   corroborates the other.** They were asked in the same call (allowed — they are not paraphrases of one question),
   but their sums are **1.31** (manual), **1.65** (page, first) and **1.25** (page, after), not 1.0. The guidance for
   this model warns that logically related questions do not sum to 1 and must not be read as complements. Treating
   "confined to getting started" as the inverse of "contains contributor plumbing" would be reading one reading twice.
2. **The judged text argues for itself, and this measurement has no control for it.** Both candidates describe their
   own quality — the manual's `Status` asserts its measurements, the page asserts "it decides nothing" and carries its
   own caveats. The guidance for this model records that text reading as *evidence about the item being judged* moves
   these models, so a favourable bias in both columns is possible and untested here.
3. **Language routing could not be verified.** The replies carry no `routing`, and the trace contains **0** lines with
   `is_english` — consistent with what this README's own `Status` already states: this deployment's server returned no
   routing in 0 of 4,369 calls. Both states are English, which is the language the question set was written in, but
   the field that would prove the checkpoint is missing on this server.

4. **The two before/afters were the AUTHOR's own edits, and unblinded.** The same agent chose what to put into the page
   and then asked the rubric about it, and nothing in the text tells the judge who wrote it. The ablation (paragraph
   removed, paragraph restored) is the closest thing here to a blind test, and it is one case. The two pairs therefore
   show that the instrument is **sensitive to a line**; they do not show that the line makes the page better in any
   sense independent of its author. The reviewer's proposal for the missing calibration — three READMEs none of us
   wrote, judged without identity hints, checked against how the community rates them — is the right next
   measurement and is not yet done.

**The readings are attributable**, which is the one thing that needs no caveat: every call appears on the trace as a
`hook: "tool"` line carrying the question ids, the provider and the model (`typesafe/jev-1.13-20260917`), so the
figures above can be traced to the exact questions that produced them.

**Three honest limits of this reading.**
1. **No battery.** Nothing here shows these questions separate a good README from a bad one on labelled cases, which
   is the standard every other question set in this repository is held to. These are readings from an uncalibrated
   instrument, and they are reported as such.
2. **`front_page_quality` on state A is missing**: the provider returned `status: "error"` twice for that question on
   that state, and the trace records it as `unreadable`. The raw upstream status is not carried (`F43`'s class), so
   the reason is not knowable from here. The other eleven answers on the same state arrived.
3. **The states are the FRONT PAGE, not the whole document** — the first 68 lines of A, all 69 of B. That is the
   surface the complaint is about, and `first_screen_sufficient` is only meaningful when the text given IS the first
   screen. Judging the whole 775-line manual is a different measurement, and a longer one.

## Cross-check: a second reviewer collected the same standards in parallel

A second agent (a different model, the `standard` preset) gathered the standards independently the same day. Both
halves are recorded because each found sources the other could not fetch.

**Sources it has that the tables above do not**: [Art of README](https://github.com/hackergrrl/art-of-readme) — the
philosophical one, with a checklist (one-liner, background, unfamiliar terms linked, a runnable example, install,
extensive API, **cognitive funneling**, caveats up front, no reliance on images, licence);
[Make a README](https://www.makeareadme.com/); the [PurpleBooth template](https://github.com/PurpleBooth/a-good-readme-template);
[dwyl/repo-badges](https://github.com/dwyl/repo-badges) (badge priority); `readme-score` (an automated scorer whose
criteria are unpublished, so nothing is attributed to it).

**Sources above that it could not fetch**: GitHub's own page — it received the navigation only — and
opensource.guide's article. The sentence that settles the operator's question is GitHub's, quoted in the table.

**The conflicts are three, not one**, and each has a resolution:

1. **Brevity against comprehensiveness.** Art of README: *"the ideal README is as short as it can be without being
   any shorter… Detailed documentation is good — make separate pages for it!"* Make a README: *"too long is better
   than too short."* GitHub: getting-started only, "longer documentation is best suited for wikis". **Resolution**:
   length is not a criterion by itself — the criteria are whether the four questions are answered and whether install
   and usage are present and runnable.
2. **Where the licence goes.** Art of README argues for it high up, because a reader disqualifies a project early on
   licence terms; Standard Readme requires it **last**. **Resolution**: the specification wins where they conflict,
   and a one-line mention near the top is compatible with both.
3. **A table of contents.** Standard Readme requires one above 100 lines — which is itself a judgement that a README
   past that length has stopped being a front page. A ToC is a navigation tax a landing page should not need.

**Criteria it added that the twelve questions do not cover**, all text-checkable: cognitive funneling (broad →
specific: description, install, usage, then reference); caveats named up front; an example that looks runnable rather
than abstract; unfamiliar terms linked; a short description under 120 characters on one line; maintainers named with
a contact. **And two it judged not checkable from text**, correctly: whether links resolve (a link checker's job, not
a judge's) and whether the description matches `package.json`'s `description` (needs the manifest).

**Where the two methods CONVERGE, without either knowing the other's answer**: both found the missing way to ask for
help or contribute — the reviewer's words *"A6 Contributing — MISSING from BOTH candidates"*, the judge's numbers
0.08 on the manual and 0.11 on the page — and both conclude the landing page is the right shape for a front page,
the reviewer from funneling/length/licence-last and the judge from the audience flip (contributor 0.57 →
first-time visitor 0.94). The gap was fixed and re-measured at 0.99.

**Where they diverge**: the reviewer treats Standard Readme's required one-line description under 120 characters as a
defect; the judge scored `states_what_it_is` 0.89–0.94 for the existing opening, so by measurement it is not the
binding constraint. Neither is authoritative — conforming to Standard Readme is a **choice** about what the project
claims, not a defect the measurement found.

**A caveat about the instrument, stated before the figures**: this question set has no battery. Nothing here has
shown that the questions separate a good README from a bad one on labelled cases — the standard this repository holds
every other question set to (`system1_battery`). The measurement below is therefore a *reading*, not a calibrated
instrument, and it is reported as such.
