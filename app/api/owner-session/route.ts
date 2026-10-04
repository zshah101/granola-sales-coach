import { createOwnerSession, matchesOwnerCode, noStoreJson, ownerAccessConfigured, requestHasOwnerSession, setOwnerCookie } from "../../lib/owner-access"
import { isRecord, readJsonBounded, RequestError, requireSameOrigin } from "../../lib/request-guards"

export const runtime = "nodejs"

export async function GET(req: Request) {
  return noStoreJson({ authenticated: ownerAccessConfigured() && requestHasOwnerSession(req) })
}

export async function POST(req: Request) {
  if (!ownerAccessConfigured()) return noStoreJson({ error: "Owner access is not configured" }, 503)
  try {
    requireSameOrigin(req)
    const body = await readJsonBounded(req, 4096)
    if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.code !== "string" || body.code.length > 512 || !matchesOwnerCode(body.code)) {
      return noStoreJson({ error: "Invalid owner access code" }, 401)
    }
    const response = noStoreJson({ authenticated: true })
    setOwnerCookie(response, createOwnerSession())
    return response
  } catch (error) {
    return noStoreJson({ error: error instanceof RequestError ? error.message : "Unable to sign in" }, error instanceof RequestError ? error.status : 500)
  }
}

export async function DELETE(req: Request) {
  try {
    requireSameOrigin(req)
    const response = noStoreJson({ authenticated: false })
    setOwnerCookie(response, "", true)
    return response
  } catch (error) {
    return noStoreJson({ error: error instanceof RequestError ? error.message : "Unable to sign out" }, error instanceof RequestError ? error.status : 500)
  }
}
