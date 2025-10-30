import { Header, HeaderData } from '../../dist/esm/header.js'
export type Chunks = (Buffer | string | HeaderData)[]

export const makeTar = (chunks: Chunks) => {
  let dataLen = 0
  return Buffer.concat(
    chunks.map(chunk => {
      if (Buffer.isBuffer(chunk)) {
        dataLen += chunk.length
        return chunk
      }
      const size = Math.max(
        typeof chunk === 'string'
          ? 512 * Math.ceil(chunk.length / 512)
          : 512,
      )
      dataLen += size
      const buf = Buffer.alloc(size)
      if (typeof chunk === 'string') {
        buf.write(chunk)
      } else {
        new Header(chunk).encode(buf, 0)
      }
      return buf
    }),
    dataLen,
  )
}
