import { NextResponse } from "next/server"

export async function POST(req: Request) {
 try {
  const { transcript } = await req.json()

  if (!transcript) {
   return NextResponse.json(
    { error: "No transcript provided" },
    { status: 400 }
   )
  }

  const systemPrompt = `
You are an expert sales coach analyzing a meeting transcript.

Your task is to determine whether the meeting is a SALES CALL.

A Sales Call usually includes signals such as:
- discussing a product or service
- identifying customer problems or needs
- explaining product features
- discussing pricing or plans
- discussing demos or free trials
- discussing next steps toward adoption or purchase

Meetings that are NOT Sales Calls include:
- internal team meetings
- engineering or project discussions
- technical support calls
- casual conversations
- status updates or planning meetings

Step 1:
Classify the meeting as either:
"Sales Call" or "Not Sales Call"

Step 2:
Provide a confidence score (0–100) and exactly 3 short reasons explaining the signals found.

Step 3:
If it is a "Sales Call", generate a coaching_pack containing:
- what_went_well: exactly 3 bullets
- improvements: exactly 5 actionable bullets
- missed_questions: exactly 5 questions
- next_steps: exactly 3 next steps
- follow_up_email: a professional follow-up email draft (5–8 lines)

If it is "Not Sales Call", return null for coaching_pack.

Respond ONLY with valid JSON that matches the provided schema.
`

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
   method: "POST",
   headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
   },
   body: JSON.stringify({
    model: "gpt-4o-mini",
    messages: [
     { role: "system", content: systemPrompt },
     {
      role: "user",
      content: `Analyze the following meeting transcript:\n\n${transcript.substring(0, 8000)}`
     }
    ],
    temperature: 0.2,
    response_format: {
     type: "json_schema",
     json_schema: {
      name: "sales_call_analysis",
      strict: true,
      schema: {
       type: "object",
       properties: {
        classification: {
         type: "string",
         enum: ["Sales Call", "Not Sales Call"]
        },
        confidence: {
         type: "number"
        },
        reasons: {
         type: "array",
         items: { type: "string" }
        },
        coaching_pack: {
         type: ["object", "null"],
         properties: {
          what_went_well: { type: "array", items: { type: "string" } },
          improvements: { type: "array", items: { type: "string" } },
          missed_questions: { type: "array", items: { type: "string" } },
          next_steps: { type: "array", items: { type: "string" } },
          follow_up_email: { type: "string" }
         },
         required: [
          "what_went_well",
          "improvements",
          "missed_questions",
          "next_steps",
          "follow_up_email"
         ],
         additionalProperties: false
        }
       },
       required: ["classification", "confidence", "reasons", "coaching_pack"],
       additionalProperties: false
      }
     }
    }
   })
  })

  const data = await response.json()
  
  // NEW: Anish's Defensive Check
  if (!data.choices || !data.choices[0]) {
    console.error("OpenAI Error:", data)
    throw new Error("Invalid AI response or rate limit hit")
  }

  const result = data.choices[0].message.content
  
  // NEW: Anish's Console Log for debugging
  console.log("AI RESULT:", result)

  return NextResponse.json({ result })

 } catch (error) {
  console.error("Backend Error:", error)
  return NextResponse.json(
   { error: "Failed to analyze transcript" },
   { status: 500 }
  )
 }
}