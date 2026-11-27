/** Copy the parts into one new array. */
export const concat = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  if (parts.length === 1) return (parts[0] as Uint8Array).slice()
  let length = 0
  for (const part of parts) length += part.length
  const out = new Uint8Array(length)
  let pos = 0
  for (const part of parts) {
    out.set(part, pos)
    pos += part.length
  }
  return out
}
