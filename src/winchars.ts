// When writing files on Windows, translate the characters to their
// 0xf000 higher-encoded versions.

const raw = ['|', '<', '>', '?', ':']

const win = raw.map(char =>
  String.fromCharCode(0xf000 + char.charCodeAt(0)),
)

const toWin = new Map(raw.map((char, i) => [char, win[i]]))
const toRaw = new Map(win.map((char, i) => [char, raw[i]]))

export const encode = (s: string) =>
  raw.reduce((s, c) => s.split(c).join(toWin.get(c)), s)
export const decode = (s: string) =>
  win.reduce((s, c) => s.split(c).join(toRaw.get(c)), s)
