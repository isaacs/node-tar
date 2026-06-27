// on windows, either \ or / are valid directory separators.
// on unix, \ is a valid character in filenames.
// so, on windows, and only on windows, we replace all \ chars with /,
// so that we can use / as our one and only directory separator char.

const platform = process.env.TESTING_TAR_FAKE_PLATFORM || process.platform

export const normalizeWindowsPath: (p: unknown) => string =
  platform !== 'win32' ?
    (p: unknown) => String(p)
  : (p: unknown) => String(p).replaceAll(/\\/g, '/')
