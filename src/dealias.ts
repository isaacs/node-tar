// The option aliases of the commands: the short names of the tar
// program, and the long names of version 7.

const aliases = {
  C: 'cwd',
  f: 'file',
  z: 'gzip',
  P: 'preservePaths',
  U: 'unlink',
  'strip-components': 'strip',
  stripComponents: 'strip',
  'keep-newer': 'newer',
  keepNewer: 'newer',
  'keep-newer-files': 'newer',
  keepNewerFiles: 'newer',
  k: 'keep',
  'keep-existing': 'keep',
  keepExisting: 'keep',
  m: 'noMtime',
  'no-mtime': 'noMtime',
  p: 'preserveOwner',
  L: 'follow',
  h: 'follow',
  onentry: 'onEntry',
  onReadEntry: 'onEntry',
} as const

type Table = typeof aliases
type Alias = keyof Table
type Aliased = Table[Alias]
type AliasOf<K> = { [A in Alias]: Table[A] extends K ? A : never }[Alias]

// The options that `T` must have.
type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K
}[keyof T]

// A union: one object type with the value for each of the names.
type Named<V, N extends PropertyKey> =
  N extends unknown ? { [P in N]: V } : never

// A function type for each option `K`, to make an intersection.
type Each<T, K extends keyof T> =
  K extends unknown ? (x: { v: Named<T[K], K | AliasOf<K>> }) => void
  : never

// For each option `K`, the option or one of its aliases is required.
type Needs<T, K extends keyof T> =
  [K] extends [never] ? unknown
  : Each<T, K> extends (x: infer I extends { v: unknown }) => void ? I['v']
  : never

type OneWithAliases<T> = Omit<T, Aliased> &
  Partial<Pick<T, keyof T & Aliased>> & {
    [A in Alias as Table[A] extends keyof T ? A : never]?: T[Table[A] &
      keyof T]
  } & ('chmod' extends keyof T ?
    {
      /** `noChmod: false` is `chmod: true`, if `chmod` is not set. */
      noChmod?: boolean
    }
  : unknown) &
  Needs<T, RequiredKeys<T> & Aliased>

/**
 * The option type `T` of a command, and the aliases of its options.
 * An alias has the type of its option. An option that `T` requires
 * can be given with its name or with an alias.
 */
export type WithAliases<T> = T extends unknown ? OneWithAliases<T> : never

/** The `file` option, with its name or with an alias. */
export type FileOption = Named<string, 'file' | AliasOf<'file'>>

/** No `file` option. */
export type NoFileOption = { [N in 'file' | AliasOf<'file'>]?: undefined }

/**
 * A copy of the options, with no prototype, that has the name of the
 * option in place of each alias. An option that is set wins over its
 * aliases.
 */
export const dealias = <T extends object>(options: WithAliases<T>): T => {
  const opt: Record<string, unknown> = Object.assign(
    Object.create(null),
    options,
  )
  for (const [alias, name] of Object.entries(aliases)) {
    if (opt[alias] !== undefined) opt[name] ??= opt[alias]
    delete opt[alias]
  }
  if (opt.noChmod === false) opt.chmod ??= true
  delete opt.noChmod
  return opt as T
}
