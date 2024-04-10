export const isCode = (c: string): c is EntryTypeCode =>
  name.has(c as EntryTypeCode)

export const isName = (c: string): c is EntryTypeName =>
  code.has(c as EntryTypeName)

export type EntryTypeCode =
  | '0'
  | ''
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | 'g'
  | 'x'
  | 'A'
  | 'D'
  | 'I'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'S'
  | 'V'
  | 'X'

export type EntryTypeName =
  | 'File'
  | 'OldFile'
  | 'Link'
  | 'SymbolicLink'
  | 'CharacterDevice'
  | 'BlockDevice'
  | 'Directory'
  | 'FIFO'
  | 'ContiguousFile'
  | 'GlobalExtendedHeader'
  | 'ExtendedHeader'
  | 'SolarisACL'
  | 'GNUDumpDir'
  | 'Inode'
  | 'NextFileHasLongLinkpath'
  | 'NextFileHasLongPath'
  | 'ContinuationFile'
  | 'OldGnuLongPath'
  | 'SparseFile'
  | 'TapeVolumeHeader'
  | 'OldExtendedHeader'
  | 'Unsupported'

// map types from key to human-friendly name
export const name = new Map<EntryTypeCode, EntryTypeName>([
  ['0', 'File'],
  // same as File
  ['', 'OldFile'],
  ['1', 'Link'],
  ['2', 'SymbolicLink'],
  // Devices and FIFOs aren't fully supported
  // they are parsed, but skipped when unpacking
  ['3', 'CharacterDevice'],
  ['4', 'BlockDevice'],
  ['5', 'Directory'],
  ['6', 'FIFO'],
  // same as File
  ['7', 'ContiguousFile'],
  // pax headers
  ['g', 'GlobalExtendedHeader'],
  ['x', 'ExtendedHeader'],
  // vendor-specific stuff
  // skip
  ['A', 'SolarisACL'],
  // like 5, but with data, which should be skipped
  ['D', 'GNUDumpDir'],
  // metadata only, skip
  ['I', 'Inode'],
  // data = link path of next file
  ['K', 'NextFileHasLongLinkpath'],
  // data = path of next file
  ['L', 'NextFileHasLongPath'],
  // skip
  ['M', 'ContinuationFile'],
  // like L
  ['N', 'OldGnuLongPath'],
  // skip
  ['S', 'SparseFile'],
  // skip
  ['V', 'TapeVolumeHeader'],
  // like x
  ['X', 'OldExtendedHeader'],
])

// map the other direction
export const code = new Map<EntryTypeName, EntryTypeCode>(
  Array.from(name).map(kv => [kv[1], kv[0]]),
)
