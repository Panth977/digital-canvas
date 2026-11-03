declare module 'brotli/decompress.js' {
  /** Brotli-decode `input` (pure JS, from the `brotli` package). */
  const decompress: (input: Uint8Array, outputSize?: number) => Uint8Array | null;
  export default decompress;
}
