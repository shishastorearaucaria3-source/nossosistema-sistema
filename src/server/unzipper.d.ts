declare module 'unzipper' {
  export interface ZipEntry {
    path: string
    type: string
    compressionMethod?: number
    compressedSize?: number
    uncompressedSize?: number
    stream(): import('node:stream').Readable
    buffer(): Promise<Buffer>
  }

  export interface ZipDirectory {
    files: ZipEntry[]
  }

  export const Open: {
    file(
      path: string,
      options?: { tailSize?: number; crx?: boolean }
    ): Promise<ZipDirectory>
  }
}