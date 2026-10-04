export type Analysis = {
  classification: "Sales Call" | "Not Sales Call"
  confidence: number
  reasons: string[]
  coaching_pack: {
    what_went_well: string[]
    improvements: string[]
    missed_questions: string[]
    next_steps: string[]
    follow_up_email: string
  } | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function textList(value: unknown, count: number) {
  return Array.isArray(value) && value.length === count && value.every(item => typeof item === "string" && item.length > 0 && item.length <= 500)
}

export function validAnalysis(value: unknown): value is Analysis {
  if (!isObject(value) || Object.keys(value).length !== 4 || !["Sales Call", "Not Sales Call"].includes(value.classification as string)
    || typeof value.confidence !== "number" || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 100 || !textList(value.reasons, 3)) return false
  if (value.classification === "Not Sales Call") return value.coaching_pack === null
  const pack = value.coaching_pack
  return isObject(pack) && Object.keys(pack).length === 5 && textList(pack.what_went_well, 3) && textList(pack.improvements, 5)
    && textList(pack.missed_questions, 5) && textList(pack.next_steps, 3)
    && typeof pack.follow_up_email === "string" && pack.follow_up_email.length > 0 && pack.follow_up_email.length <= 3000
}
