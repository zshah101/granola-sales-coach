import "server-only"
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"

const PURPOSE = "granola-sales-coach:owner-session:v1"
export const SESSION_SECONDS = 60 * 60

export function cookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Host-granola-owner-session"
    : "granola-owner-session"
}

function ownerCode() {
  const code = process.env.AI_OWNER_ACCESS_CODE
  // Length alone also accepts spaces and repeated characters. Deployment still
  // requires a randomly generated code; no validator can prove randomness.
  return code && code.length >= 32 && code.length <= 512 && !/\s/.test(code)
    && new Set(code).size >= 8 && !/^(?:change[-_]?me|replace[-_]?me|your[-_]|example[-_])/i.test(code) ? code : null
}

export function ownerAccessConfigured() {
  return ownerCode() !== null
}

export function matchesOwnerCode(candidate: string) {
  const code = ownerCode()
  if (!code) return false
  const digest = (value: string) => createHash("sha256").update(value).digest()
  return timingSafeEqual(digest(candidate), digest(code))
}

function signature(payload: string, code: string) {
  return createHmac("sha256", code).update(`${PURPOSE}\n${payload}`).digest()
}

export function createOwnerSession(now = Date.now()) {
  const code = ownerCode()
  if (!code) throw new Error("Owner access unavailable")
  const issued = Math.floor(now / 1000)
  const payload = Buffer.from(JSON.stringify({ purpose: PURPOSE, issued, expires: issued + SESSION_SECONDS, nonce: randomBytes(16).toString("hex") })).toString("base64url")
  return `${payload}.${signature(payload, code).toString("base64url")}`
}

export function validOwnerSession(token: string | undefined, now = Date.now()) {
  const code = ownerCode()
  if (!code || !token || token.length > 1024) return false
  const parts = token.split(".")
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return false
  const received = Buffer.from(parts[1], "base64url")
  const expected = signature(parts[0], code)
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"))
    const current = Math.floor(now / 1000)
    return payload.purpose === PURPOSE && Number.isInteger(payload.issued) && Number.isInteger(payload.expires)
      && payload.issued <= current && payload.expires > current
      && payload.expires - payload.issued === SESSION_SECONDS
      && typeof payload.nonce === "string" && /^[a-f0-9]{32}$/.test(payload.nonce)
  } catch {
    return false
  }
}

export function requestHasOwnerSession(req: Request) {
  const name = `${cookieName()}=`
  const cookies = (req.headers.get("cookie") || "").split(";").map(part => part.trim()).filter(part => part.startsWith(name))
  return cookies.length === 1 && validOwnerSession(cookies[0].slice(name.length))
}

export function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private", "Vary": "Cookie" } })
}

export function setOwnerCookie(response: NextResponse, token: string, clear = false) {
  response.cookies.set(cookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: clear ? 0 : SESSION_SECONDS,
  })
}
