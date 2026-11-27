// The POSIX path functions that tar paths need. Each one gives the
// same result as the function of the same name in `path.posix`.

/** Resolve `.` and `..` parts, and remove repeated slashes. */
export const normalize = (path: string): string => {
  const absolute = path.charCodeAt(0) === 47
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') out.push(part)
    else if (out.length && out[out.length - 1] !== '..') out.pop()
    else if (!absolute) out.push(part)
  }
  const trail = out.length && path.charCodeAt(path.length - 1) === 47
  const res = out.join('/') + (trail ? '/' : '')
  if (absolute) return '/' + res
  return res || (path.endsWith('/') ? './' : '.')
}

/** Join the parts with a slash, then normalize the result. */
export const join = (...parts: string[]): string =>
  normalize(parts.filter(p => p).join('/'))

/** The path without its last part. */
export const dirname = (path: string): string => {
  let end = path.length
  while (end > 1 && path.charCodeAt(end - 1) === 47) end--
  const slash = path.lastIndexOf('/', end - 1)
  if (slash === -1) return '.'
  if (slash === 0) return '/'
  if (slash === 1 && path.charCodeAt(0) === 47) return '//'
  return path.slice(0, slash)
}

/** The last part of the path. */
export const basename = (path: string): string => {
  let end = path.length
  while (end > 0 && path.charCodeAt(end - 1) === 47) end--
  return path.slice(path.lastIndexOf('/', end - 1) + 1, end)
}

/** True if the path starts with a slash. */
export const isAbsolute = (path: string): boolean =>
  path.charCodeAt(0) === 47

/**
 * Resolve the parts from right to left, up to the first absolute
 * part. There is no working directory here: if no part is absolute,
 * the result is a relative path.
 */
export const resolve = (...parts: string[]): string => {
  let path = ''
  for (let i = parts.length - 1; i >= 0 && !isAbsolute(path); i--) {
    const part = parts[i]
    if (part) path = path ? part + '/' + path : part
  }
  const res = normalize(path)
  return res.length > 1 && res.endsWith('/') ? res.slice(0, -1) : res
}

/** The relative path from `from` to `to`. */
export const relative = (from: string, to: string): string => {
  const f = resolve(from).split('/')
  const t = resolve(to).split('/')
  // The root gives an empty last part.
  if (!f[f.length - 1]) f.pop()
  if (!t[t.length - 1]) t.pop()
  let same = 0
  while (same < f.length && same < t.length && f[same] === t[same]) same++
  return [
    ...Array.from({ length: f.length - same }, () => '..'),
    ...t.slice(same),
  ].join('/')
}
