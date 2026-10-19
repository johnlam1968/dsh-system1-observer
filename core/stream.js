// THE ONLY SEAM THAT IS NOT A DECISION, so it is the only one that needs its own shape.
//
// `llm/stream`'s `next()` returns an AsyncIterable, not a decision. Passing the chunks through untouched while
// keeping a copy is what keeps the operator's streaming intact: the call happens after the last chunk, never
// before the first. Buffering first -- which is what a pre-delivery guard must do -- would make the operator
// wait for the decision model on every reply, and this plugin decides nothing.
//
// The text extraction mirrors `guardStream`'s measured preference: a finished text block is the whole block,
// and deltas are the fallback for a stream that never emitted one.
export function textOf(chunks) {
  const finished = []
  for (const chunk of chunks) {
    if (chunk?.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
      finished.push(chunk.block.text)
    }
  }
  if (finished.length > 0) return finished.join('\n')
  const deltas = []
  for (const chunk of chunks) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') deltas.push(chunk.text)
  }
  return deltas.join('')
}

/**
 * Relay a stream unchanged while collecting it, then hand the collection to `onEnd`.
 *
 * @param source the AsyncIterable from `next()`
 * @param onEnd  awaited once, after the source completes and before the generator returns
 * @returns an AsyncGenerator yielding exactly the source's chunks, in order, unmodified
 */
export async function* tee(source, onEnd) {
  const chunks = []
  for await (const chunk of source) {
    chunks.push(chunk)
    yield chunk
  }
  await onEnd(chunks)
}
