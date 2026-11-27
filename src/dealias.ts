/**
 * The option aliases of the commands: the short names of the tar
 * program, and the long names of version 7. Each alias has the name
 * of its option.
 */
export const aliases = {
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

/** The alias names, and the name of the option of each one. */
export type Aliases = typeof aliases

/** The names of the options that have an alias. */
export type Aliased = Aliases[keyof Aliases]

/** The alias names of the option `K`. */
export type AliasOf<K> = {
  [A in keyof Aliases]: Aliases[A] extends K ? A : never
}[keyof Aliases]

/**
 * For each option `K` of `T`, an object type that requires the option
 * or one of its aliases.
 */
export type RequiredOption<T, K extends keyof T> =
  [K] extends [never] ? unknown
  : // A function type for each option, to make an intersection.
  (
    K extends unknown ?
      (x: {
        // A union: one object type for each name of the option.
        v: { [N in K | AliasOf<K>]: { [P in N]: T[K] } }[K | AliasOf<K>]
      }) => void
    : never
  ) extends (x: infer I extends { v: unknown }) => void ?
    I['v']
  : never

/**
 * The option type `T` of a command, and the aliases of its options.
 * An alias has the type of its option. An option that `T` requires
 * can be given with its name or with an alias.
 */
export type WithAliases<T> =
  T extends unknown ?
    Omit<T, Aliased> &
      Partial<Pick<T, keyof T & Aliased>> & {
        [A in keyof Aliases as Aliases[A] extends keyof T ? A
        : never]?: T[Aliases[A] & keyof T]
      } & ('chmod' extends keyof T ?
        {
          /** `noChmod: false` is `chmod: true`, if `chmod` is not set. */
          noChmod?: boolean
        }
      : unknown) &
      RequiredOption<
        T,
        // The options that `T` must have.
        {
          [K in keyof T]-?: object extends Pick<T, K> ? never : K
        }[keyof T] &
          Aliased
      >
  : never

/** The `file` option, with its name or with its alias. */
export type FileOption = RequiredOption<{ file: string }, 'file'>

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
