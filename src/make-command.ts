import {
  dealias,
  isAsyncFile,
  isAsyncNoFile,
  isSyncFile,
  isSyncNoFile,
  TarOptions,
  TarOptionsAsyncFile,
  TarOptionsAsyncNoFile,
  TarOptionsSyncFile,
  TarOptionsSyncNoFile,
  TarOptionsWithAliases,
  TarOptionsWithAliasesAsync,
  TarOptionsWithAliasesAsyncFile,
  TarOptionsWithAliasesAsyncNoFile,
  TarOptionsWithAliasesFile,
  TarOptionsWithAliasesNoFile,
  TarOptionsWithAliasesSync,
  TarOptionsWithAliasesSyncFile,
  TarOptionsWithAliasesSyncNoFile,
} from './options.js'

export type CB = (er?: Error) => any

export type TarCommand<
  AsyncClass,
  SyncClass extends { sync: true },
> = {
  // async and no file specified
  (): AsyncClass
  (opt: TarOptionsWithAliasesAsyncNoFile): AsyncClass
  (entries: string[]): AsyncClass
  (
    opt: TarOptionsWithAliasesAsyncNoFile,
    entries: string[],
  ): AsyncClass
} & {
  // sync and no file
  (opt: TarOptionsWithAliasesSyncNoFile): SyncClass
  (opt: TarOptionsWithAliasesSyncNoFile, entries: string[]): SyncClass
} & {
  // async and file
  (opt: TarOptionsWithAliasesAsyncFile): Promise<void>
  (
    opt: TarOptionsWithAliasesAsyncFile,
    entries: string[],
  ): Promise<void>
  (opt: TarOptionsWithAliasesAsyncFile, cb: CB): Promise<void>
  (
    opt: TarOptionsWithAliasesAsyncFile,
    entries: string[],
    cb: CB,
  ): Promise<void>
} & {
  // sync and file
  (opt: TarOptionsWithAliasesSyncFile): void
  (opt: TarOptionsWithAliasesSyncFile, entries: string[]): void
} & {
  // sync, maybe file
  (opt: TarOptionsWithAliasesSync): typeof opt extends (
    TarOptionsWithAliasesFile
  ) ?
    void
  : typeof opt extends TarOptionsWithAliasesNoFile ? SyncClass
  : void | SyncClass
  (
    opt: TarOptionsWithAliasesSync,
    entries: string[],
  ): typeof opt extends TarOptionsWithAliasesFile ? void
  : typeof opt extends TarOptionsWithAliasesNoFile ? SyncClass
  : void | SyncClass
} & {
  // async, maybe file
  (opt: TarOptionsWithAliasesAsync): typeof opt extends (
    TarOptionsWithAliasesFile
  ) ?
    Promise<void>
  : typeof opt extends TarOptionsWithAliasesNoFile ? AsyncClass
  : Promise<void> | AsyncClass
  (
    opt: TarOptionsWithAliasesAsync,
    entries: string[],
  ): typeof opt extends TarOptionsWithAliasesFile ? Promise<void>
  : typeof opt extends TarOptionsWithAliasesNoFile ? AsyncClass
  : Promise<void> | AsyncClass
  (opt: TarOptionsWithAliasesAsync, cb: CB): Promise<void>
  (
    opt: TarOptionsWithAliasesAsync,
    entries: string[],
    cb: CB,
  ): typeof opt extends TarOptionsWithAliasesFile ? Promise<void>
  : typeof opt extends TarOptionsWithAliasesNoFile ? never
  : Promise<void>
} & {
  // maybe sync, file
  (opt: TarOptionsWithAliasesFile): Promise<void> | void
  (
    opt: TarOptionsWithAliasesFile,
    entries: string[],
  ): typeof opt extends TarOptionsWithAliasesSync ? void
  : typeof opt extends TarOptionsWithAliasesAsync ? Promise<void>
  : Promise<void> | void
  (opt: TarOptionsWithAliasesFile, cb: CB): Promise<void>
  (
    opt: TarOptionsWithAliasesFile,
    entries: string[],
    cb: CB,
  ): typeof opt extends TarOptionsWithAliasesSync ? never
  : typeof opt extends TarOptionsWithAliasesAsync ? Promise<void>
  : Promise<void>
} & {
  // maybe sync, no file
  (opt: TarOptionsWithAliasesNoFile): typeof opt extends (
    TarOptionsWithAliasesSync
  ) ?
    SyncClass
  : typeof opt extends TarOptionsWithAliasesAsync ? AsyncClass
  : SyncClass | AsyncClass
  (
    opt: TarOptionsWithAliasesNoFile,
    entries: string[],
  ): typeof opt extends TarOptionsWithAliasesSync ? SyncClass
  : typeof opt extends TarOptionsWithAliasesAsync ? AsyncClass
  : SyncClass | AsyncClass
} & {
  // maybe sync, maybe file
  (opt: TarOptionsWithAliases): typeof opt extends (
    TarOptionsWithAliasesFile
  ) ?
    typeof opt extends TarOptionsWithAliasesSync ? void
    : typeof opt extends TarOptionsWithAliasesAsync ? Promise<void>
    : void | Promise<void>
  : typeof opt extends TarOptionsWithAliasesNoFile ?
    typeof opt extends TarOptionsWithAliasesSync ? SyncClass
    : typeof opt extends TarOptionsWithAliasesAsync ? AsyncClass
    : SyncClass | AsyncClass
  : typeof opt extends TarOptionsWithAliasesSync ? SyncClass | void
  : typeof opt extends TarOptionsWithAliasesAsync ?
    AsyncClass | Promise<void>
  : SyncClass | void | AsyncClass | Promise<void>
} & {
  // extras
  syncFile: (opt: TarOptionsSyncFile, entries: string[]) => void
  asyncFile: (
    opt: TarOptionsAsyncFile,
    entries: string[],
    cb?: CB,
  ) => Promise<void>
  syncNoFile: (
    opt: TarOptionsSyncNoFile,
    entries: string[],
  ) => SyncClass
  asyncNoFile: (
    opt: TarOptionsAsyncNoFile,
    entries: string[],
  ) => AsyncClass
  validate?: (opt: TarOptions, entries?: string[]) => void
}

export const makeCommand = <
  AsyncClass,
  SyncClass extends { sync: true },
>(
  syncFile: (opt: TarOptionsSyncFile, entries: string[]) => void,
  asyncFile: (
    opt: TarOptionsAsyncFile,
    entries: string[],
    cb?: CB,
  ) => Promise<void>,
  syncNoFile: (
    opt: TarOptionsSyncNoFile,
    entries: string[],
  ) => SyncClass,
  asyncNoFile: (
    opt: TarOptionsAsyncNoFile,
    entries: string[],
  ) => AsyncClass,
  validate?: (opt: TarOptions, entries?: string[]) => void,
): TarCommand<AsyncClass, SyncClass> => {
  return Object.assign(
    (
      opt_: TarOptionsWithAliases | string[] = [],
      entries?: string[] | CB,
      cb?: CB,
    ) => {
      if (Array.isArray(opt_)) {
        entries = opt_
        opt_ = {}
      }

      if (typeof entries === 'function') {
        cb = entries
        entries = undefined
      }

      if (!entries) {
        entries = []
      } else {
        entries = Array.from(entries)
      }

      const opt = dealias(opt_)

      validate?.(opt, entries)

      if (isSyncFile(opt)) {
        if (typeof cb === 'function') {
          throw new TypeError(
            'callback not supported for sync tar functions',
          )
        }
        return syncFile(opt, entries)
      } else if (isAsyncFile(opt)) {
        const p = asyncFile(opt, entries)
        // weirdness to make TS happy
        const c = cb ? cb : undefined
        return c ? p.then(() => c(), c) : p
      } else if (isSyncNoFile(opt)) {
        if (typeof cb === 'function') {
          throw new TypeError(
            'callback not supported for sync tar functions',
          )
        }
        return syncNoFile(opt, entries)
      } else if (isAsyncNoFile(opt)) {
        if (typeof cb === 'function') {
          throw new TypeError(
            'callback only supported with file option',
          )
        }
        return asyncNoFile(opt, entries)
        /* c8 ignore start */
      } else {
        throw new Error('impossible options??')
      }
      /* c8 ignore stop */
    },
    {
      syncFile,
      asyncFile,
      syncNoFile,
      asyncNoFile,
      validate,
    },
  ) as TarCommand<AsyncClass, SyncClass>
}
