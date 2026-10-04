import "server-only"

export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function requireSameOrigin(req: Request) {
  const origin = req.headers.get("origin")
  // Next can construct Request.url with its internal hostname. Host represents
  // the actual browser destination; do not trust a caller's forwarded host.
  const requestUrl = new URL(req.url)
  const host = req.headers.get("host") ?? requestUrl.host
  const protocol = req.headers.get("x-forwarded-proto") ?? requestUrl.protocol.slice(0, -1)
  if (!/^(?:[A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\])(?::\d{1,5})?$/.test(host)
    || !["http", "https"].includes(protocol)) throw new RequestError(403, "Request origin is not allowed")
  let expected: string
  try { expected = new URL(`${protocol}://${host}`).origin } catch { throw new RequestError(403, "Request origin is not allowed") }
  if (!origin || origin !== expected || req.headers.get("sec-fetch-site") === "cross-site") {
    throw new RequestError(403, "Request origin is not allowed")
  }
}

export async function readJsonBounded(req: Pick<Request, "body" | "headers">, maxBytes: number, timeoutMs = 5000): Promise<unknown> {
  const contentType = req.headers.get("content-type")?.split(";")[0].trim().toLowerCase()
  if (contentType !== "application/json") throw new RequestError(415, "Use application/json")
  const declaredLength = req.headers.get("content-length")
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    throw new RequestError(413, "Request body is too large")
  }
  if (!req.body) throw new RequestError(400, "A JSON body is required")
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timeout: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new RequestError(408, "Request body timed out"))
      void reader.cancel().catch(() => {})
    }, timeoutMs)
  })
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline])
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        void reader.cancel().catch(() => {})
        throw new RequestError(413, "Request body is too large")
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    if (error instanceof RequestError) throw error
    throw new RequestError(400, "Invalid JSON body")
  } finally {
    clearTimeout(timeout!)
    reader.releaseLock()
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
