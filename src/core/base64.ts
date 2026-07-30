/**
 * Chunked base64 for pixel buffers (btoa/atob choke on long call stacks if
 * fed via String.fromCharCode(...spread)).
 *
 * @packageDocumentation
 * @internal
 */

/** @internal */
export function bytesToBase64(bytes: Uint8ClampedArray | Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** @internal */
export function base64ToBytes(encoded: string): Uint8ClampedArray {
  const binary = atob(encoded)
  const bytes = new Uint8ClampedArray(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
