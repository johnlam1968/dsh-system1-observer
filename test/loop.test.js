// ONE HONEST ITERATION, as bookkeeping rather than as faith.
//
// Item 4 of the plan is a loop: ask, READ, REWRITE the set, ask again. Whether a rewrite made a question BETTER is a
// question this device cannot answer yet -- that needs a labelled battery, which is designed and not built (ROADMAP
// 13.5). What it CAN do is refuse to let the iteration be read as an improvement: the old set keeps its identity, the
// new set gets its own, and the reading that spans both declines to pool them.
//
// So this test asserts the LOOP'S HONESTY, not its success: that a question which never separates is visible as such,
// that a revision is a NEW composition whose hash differs and whose parent's bytes are untouched, and that the summary
// refuses to average across the two.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createQuestionsTool } from '../lib/questions-tool.js'
import { createResultsTool } from '../lib/results-tool.js'
import { labelHash } from '../lib/label-hash.js'
import { listSets } from '../lib/question-sets.js'

const line = (record) => JSON.stringify(record)
const noul = (id, instructions) => ({ id, type: 'noul', instructions })

test('ONE HONEST ITERATION: read, rewrite as a NEW composition, re-read -- and the view refuses to pool the two', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'system1-loop-'))
  const questions = createQuestionsTool({ dir })

  // ---- the first set, and its reading ---------------------------------------------------------------
  const first = await questions.execute({ action: 'write', set: 'house@1', scope: 'draft', specs: [noul('draft_is_short', 'Is the request short?')] })
  assert.equal(first.created, true, 'the composition directory was created by the write')
  assert.deepEqual(first.problems, undefined)
  const setA = first.hash
  const draftA = readFileSync(join(dir, 'house@1', 'draft.json'), 'utf8')

  const tracePath = join(dir, 'trace.jsonl')
  const mounted = (run, questionSetHash) => ({ event: 'mount', run, model: 'jev-latest', provider: 'typesafe', hooks: ['draft'], probeHash: 'probehash123', questionSetHash, harnessHash: labelHash('v1 terse'), userHash: labelHash('operator-a') })
  const asked = (run, id, answered) => ({ event: 'call', run, hook: 'draft', agentId: 'session-a', model: 'jev-latest', provider: 'typesafe', harnessHash: labelHash('v1 terse'), userHash: labelHash('operator-a'), questions: { [id]: noul(id, 'asked') }, answer: { answers: { [id]: answered } } })
  writeFileSync(tracePath, [
    line(mounted('r1', setA)),
    line(asked('r1', 'draft_is_short', { probability: 0.9 })),
    line(asked('r1', 'draft_is_short', { probability: 0.8 })),
    line(asked('r1', 'draft_is_short', { probability: 0.95 })),
  ].join('\n') + '\n')

  // ---- step 2: READ. The question works, and nothing here can be attributed to a technique it did not record.
  const results = createResultsTool({ path: tracePath })
  const firstRead = await results.execute({})
  const question = firstRead.groups[0].questions[0]
  assert.equal(question.id, 'draft_is_short')
  assert.equal(question.read, 3)
  assert.equal(question.separates, null === question.separates ? undefined : question.separates, 'three answers on one side is not a separation claim')
  assert.equal(question.probabilities.listed.length, 3, 'and the three are listed rather than averaged')
  assert.equal('mean' in question.probabilities, false)
  assert.deepEqual(firstRead.runs, [{ run: 'r1', calls: 3, model: 'jev-latest', questionSetHash: setA, harnessHash: labelHash('v1 terse'), userHash: labelHash('operator-a') }], 'the run table joins the reading to the set and the technique')

  // ---- step 3: REWRITE, as a new composition. The old bytes keep their identity, which is the whole reason for it.
  const second = await questions.execute({ action: 'write', set: 'house@2', scope: 'draft', specs: [noul('draft_is_short', 'Is the request short enough to act on without unpacking it?')] })
  assert.equal(second.created, true)
  const setB = second.hash
  assert.notEqual(setB, setA, 'a revision is a new instrument')
  assert.equal(readFileSync(join(dir, 'house@1', 'draft.json'), 'utf8'), draftA, 'and the published set is untouched')
  assert.deepEqual(listSets(dir).sets.map((s) => s.name), ['house@1', 'house@2'], 'two compositions, both selectable')

  // ---- step 4: ask again and RE-READ. Now the reading spans two instruments.
  writeFileSync(tracePath, [
    line(mounted('r1', setA)),
    line(asked('r1', 'draft_is_short', { probability: 0.9 })),
    line(asked('r1', 'draft_is_short', { probability: 0.8 })),
    line(asked('r1', 'draft_is_short', { probability: 0.95 })),
    line(mounted('r2', setB)),
    line(asked('r2', 'draft_is_short', { probability: 0.1 })),
    line(asked('r2', 'draft_is_short', { probability: 0.9 })),
  ].join('\n') + '\n')
  const secondRead = await results.execute({})
  assert.deepEqual(secondRead.runs.map((r) => r.questionSetHash), [setA, setB], 'both runs are listed, each with its own set')
  assert.match(secondRead.refusals.join(' '), /spans 2 question set\(s\)/, 'and the view REFUSES to pool them: the iteration cannot be read as an improvement')
  // The same question id now has two answers on opposite sides -- which is exactly what must NOT be reported as one
  // distribution, and why the refusal exists rather than a warning.
  const pooled = secondRead.groups[0].questions[0]
  assert.equal(pooled.read, 5, 'the group still shows every reading')
  assert.equal(pooled.separates, true, 'and this is what the pooled view would have claimed -- the refusal is what stops it being read that way')
})
