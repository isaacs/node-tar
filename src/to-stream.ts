/**
 * Make a stream of the chunks of an iterator. It asks the iterator
 * for a chunk only when a consumer reads the stream. A cancel of the
 * stream calls `return()` of the iterator.
 */
export const toStream = (
  chunks: AsyncIterator<Uint8Array, unknown>,
): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>(
    {
      pull: async controller => {
        const res = await chunks.next()
        if (res.done) controller.close()
        else controller.enqueue(res.value)
      },
      cancel: async () => {
        await chunks.return?.()
      },
    },
    { highWaterMark: 0 },
  )
