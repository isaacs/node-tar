// Text and byte helpers that work on a plain Uint8Array in any
// JavaScript runtime, and type checks for the input of a caller.
//
// A check with `instanceof` is false for an object that a different
// realm made, such as a Node.js `Buffer` in a `node:vm` context, or a
// `Blob` of a different window. These checks are true for an object
// of each realm.

/** True for a `Uint8Array`, and for a subclass such as `Buffer`. */
export const isUint8Array = (x: unknown): x is Uint8Array =>
  ArrayBuffer.isView(x) &&
  (x as Uint8Array)[Symbol.toStringTag] === 'Uint8Array'

/** True for an `ArrayBuffer`. */
export const isArrayBuffer = (x: unknown): x is ArrayBuffer =>
  Object.prototype.toString.call(x) === '[object ArrayBuffer]'

/** True for an object that has the size and the stream of a `Blob`. */
export const isBlob = (x: unknown): x is Blob =>
  typeof (x as Blob | undefined)?.size === 'number' &&
  typeof (x as Blob).stream === 'function'

/** True for an object that has the reader of a `ReadableStream`. */
export const isReadableStream = (
  x: unknown,
): x is ReadableStream<Uint8Array> =>
  typeof (x as ReadableStream | undefined)?.getReader === 'function'

// A name can start with U+FEFF. The decoder must keep it.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const encoder = new TextEncoder()

/** The number of bytes in the UTF-8 form of the string. */
export const utf8Length = (str: string): number => {
  let len = str.length
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 0x80) continue
    if (c < 0x800) {
      len += 1
    } else if (
      c >= 0xd800 &&
      c <= 0xdbff &&
      (str.charCodeAt(i + 1) & 0xfc00) === 0xdc00
    ) {
      // A surrogate pair is 2 code units, and 4 bytes.
      len += 2
      i++
    } else {
      len += 2
    }
  }
  return len
}

/** Decode the bytes from `start` to `end` as UTF-8. */
export const decodeUtf8 = (
  buf: Uint8Array,
  start: number = 0,
  end: number = buf.length,
): string => {
  // Most names in an archive are short ASCII. That case needs no
  // decoder call.
  let str = ''
  for (let i = start; i < end; i++) {
    const c = buf[i] as number
    if (c >= 0x80) return decoder.decode(buf.subarray(start, end))
    str += String.fromCharCode(c)
  }
  return str
}

/**
 * Write the string as UTF-8 into `size` bytes at `off`. Fill the bytes
 * that are left with zeros. A character that does not fit completely
 * is not written.
 */
export const encodeUtf8Into = (
  str: string,
  buf: Uint8Array,
  off: number,
  size: number,
): void => {
  const { written } = encoder.encodeInto(
    str,
    buf.subarray(off, off + size),
  )
  buf.fill(0, off + written, off + size)
}

/** Write a string of ASCII characters at `off`. */
export const writeAscii = (
  str: string,
  buf: Uint8Array,
  off: number,
): void => {
  for (let i = 0; i < str.length; i++) {
    buf[off + i] = str.charCodeAt(i)
  }
}
