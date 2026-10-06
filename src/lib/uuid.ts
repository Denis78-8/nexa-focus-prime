/**
 * RFC 4122 version-4 UUID that also works outside secure contexts.
 *
 * crypto.randomUUID() exists only on HTTPS and localhost, so the app opened
 * over plain HTTP on a LAN address (e.g. http://10.11.134.114) does not have
 * it. crypto.getRandomValues() is available in both cases and is used to
 * build the same format by hand.
 */
export function createUuid(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("Браузер не поддерживает криптографически стойкую генерацию идентификаторов");
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
