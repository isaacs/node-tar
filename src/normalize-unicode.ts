// warning: extremely hot code path.
// This has been meticulously optimized for use
// within npm install on large package trees.
// Do not edit without careful benchmarking.
const normalizeCache: Record<string, string> = Object.create(null)

// Limit the size of this. Very low-sophistication LRU cache
const MAX = 10000
const cache = new Set<string>()
export const normalizeUnicode = (s: string): string => {
  if (!cache.has(s)) {
    normalizeCache[s] = s.normalize('NFD')
  } else {
    cache.delete(s)
  }
  cache.add(s)

  const ret = normalizeCache[s] as string

  let i = cache.size - MAX
  // only prune when we're 10% over the max
  if (i > MAX / 10) {
    for (const s of cache) {
      cache.delete(s)
      delete normalizeCache[s]
      if (--i <= 0) break
    }
  }

  return ret
}
