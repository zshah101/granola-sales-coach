"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import OwnerAccess from "./components/owner-access"
import { validAnalysis } from "./lib/analysis-contract"
import type { Analysis } from "./lib/analysis-contract"

export default function Home(){

 const [transcript,setTranscript] = useState("")
 const [result,setResult] = useState<Analysis | null>(null)
 const [loading,setLoading] = useState(false)
 const [history,setHistory] = useState<{timestamp: number; result: Analysis}[]>([])
 const [owner,setOwner] = useState(false)
 const [savedHistory,setSavedHistory] = useState(false)
 const [error,setError] = useState("")
 const [emailCopied,setEmailCopied] = useState(false)
 const [feedbackCopied,setFeedbackCopied] = useState(false)
 const pendingAnalysis = useRef<AbortController | null>(null)

 useEffect(()=>{
  try { setSavedHistory(localStorage.getItem("meetingHistory") !== null) } catch {}
 },[])

 const changeOwner = useCallback((authenticated: boolean) => {
  setOwner(authenticated)
  if (!authenticated) {
   pendingAnalysis.current?.abort()
   setResult(null); setTranscript(""); setHistory([])
  }
 }, [])

 useEffect(() => () => pendingAnalysis.current?.abort(), [])

 async function copyText(text:string){
  try{
   await navigator.clipboard.writeText(text)
  }catch{
   const textarea=document.createElement("textarea")
   textarea.value=text
   textarea.style.position="fixed"
   textarea.style.left="-9999px"
   document.body.appendChild(textarea)
   textarea.focus()
   textarea.select()
   document.execCommand("copy")
   document.body.removeChild(textarea)
  }
 }

 async function copyEmail(){
  if(!result?.coaching_pack) return
  await copyText(result.coaching_pack.follow_up_email)
  setEmailCopied(true)
  setTimeout(()=>setEmailCopied(false),2000)
 }

 async function copyFeedback(){
  if(!result?.coaching_pack) return

  const text=`
What Went Well:
${result.coaching_pack.what_went_well.join("\n")}

Improvements:
${result.coaching_pack.improvements.join("\n")}

Missed Questions:
${result.coaching_pack.missed_questions.join("\n")}

Next Steps:
${result.coaching_pack.next_steps.join("\n")}
`
  await copyText(text)
  setFeedbackCopied(true)
  setTimeout(()=>setFeedbackCopied(false),2000)
 }

 async function analyze(){

   if(!owner || !transcript.trim()) return

  if(transcript.length>8000){
    setError("Please use a transcript of 8000 characters or fewer.")
    return
  }

  setLoading(true)
  setError("")
  pendingAnalysis.current?.abort()
  const controller = new AbortController()
  pendingAnalysis.current = controller

  try{

   const res=await fetch("/api/analyze",{
    method:"POST",
    signal:controller.signal,
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({transcript})
   })

   const data=await res.json()
   if (controller.signal.aborted) return

   if (!res.ok) {
    if (res.status === 401) changeOwner(false)
    setError(data.error || "Unable to analyze this transcript.")
    return
   }
   const parsed = data.result
   if (!validAnalysis(parsed)) throw new Error("Invalid response")

   setResult(parsed)

   setHistory(previous => [{timestamp:Date.now(), result:parsed}, ...previous].slice(0,10))

  }catch{
   if (!controller.signal.aborted) setError("Unable to analyze this transcript. Please try again.")
  }finally{
   if (pendingAnalysis.current === controller) {
    pendingAnalysis.current = null
    setLoading(false)
   }
  }
 }

 function clearHistory(){
  pendingAnalysis.current?.abort()
  try { localStorage.removeItem("meetingHistory"); setSavedHistory(false) } catch { setError("Unable to delete previously saved history.") }
  setHistory([])
  setResult(null)
  setTranscript("")
 }

 return(

 <div className="min-h-screen bg-slate-950 text-slate-200 selection:bg-blue-500/30 font-sans">

 <main className="max-w-2xl mx-auto px-6 py-16">

 {/* Header */}
 <div className="text-center mb-12">
  <h1 className="text-4xl md:text-5xl font-extrabold mb-3 tracking-tight bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent">
   Granola Sales Coach
  </h1>
  <p className="text-slate-400 text-lg">
   AI-powered feedback for your sales meetings
  </p>
 </div>

 <OwnerAccess authenticated={owner} onChange={changeOwner} />

 {/* Integration Status Area [cite: 36] */}
 <div className="mb-8 bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 rounded-xl text-sm flex items-center justify-center gap-2 text-emerald-400 font-medium">
  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
  Drafts stay in this tab. Review them before copying or sending.
 </div>

 {/* Input Container */}
 <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 shadow-2xl">
  <textarea
   aria-label="Meeting transcript"
   className="w-full h-40 bg-slate-950/50 border border-slate-700/50 rounded-xl p-4 text-slate-200 placeholder-slate-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition resize-y"
   placeholder="Paste your Granola meeting transcript here..."
   value={transcript}
   onChange={(e)=>setTranscript(e.target.value)}
  />

  <button
   onClick={analyze}
   disabled={loading || !owner || !transcript.trim()}
   className="mt-5 w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-50 disabled:cursor-not-allowed py-3.5 rounded-xl font-bold text-white shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98]"
  >
   {loading ? "AI is analyzing meeting..." : owner ? "Analyze Meeting" : "Owner access required"}
  </button>
  <p className="mt-3 text-xs text-slate-400">Analysis sends your transcript to OpenAI. Avoid passwords, API keys, and sensitive customer information.</p>
  {error && <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p>}
 </div>

 {savedHistory && <div className="mt-4 rounded-xl border border-slate-800 p-4 text-sm text-slate-400">
  <p>History saved by the previous version is still in this browser. New analyses are no longer saved. You can delete the older saved history here.</p>
  <button type="button" onClick={clearHistory} className="mt-3 text-rose-300 underline">Delete previously saved history</button>
 </div>}

 {/* History Area [cite: 37] */}
 {history.length>0 && (
 <div className="mt-8 bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">
   This Tab’s Recent Meetings
  </h3>
  <ul className="space-y-2">
   {history.map((h,i)=>(
    <li
     key={i}
     onClick={()=>setResult(h.result)}
     className="cursor-pointer text-slate-300 hover:text-white hover:bg-slate-800/50 transition-colors text-sm bg-slate-950/50 border border-slate-800/50 p-3 rounded-xl flex justify-between items-center"
    >
     <span>{new Date(h.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
     <span className={`text-xs font-bold px-2 py-1 rounded-md ${h.result.classification === "Sales Call" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
       {h.result.classification}
     </span>
    </li>
   ))}
  </ul>
  <button
   onClick={clearHistory}
   className="mt-5 text-xs font-semibold text-rose-400 hover:text-rose-300 transition"
  >
   Delete history
  </button>
 </div>
 )}

 {/* Results Area [cite: 38] */}
 {result && (
 <div className="mt-12 space-y-6">

 {/* Classification Card [cite: 41] */}
 <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl">
  <div className="flex items-center gap-4 mb-4">
   <span className={`px-4 py-1.5 text-sm rounded-full font-bold shadow-lg ${
    result.classification==="Sales Call"
     ? "bg-emerald-500 text-slate-950 shadow-emerald-500/20"
     : "bg-rose-500 text-white shadow-rose-500/20"
   }`}>
    {result.classification}
   </span>

   <span className="text-slate-400 text-sm font-medium">
    Confidence: <span className="text-slate-200">{result.confidence}%</span>
   </span>
  </div>

  <div className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2 mt-6">Signals Detected</div>
  <ul className="space-y-2 text-slate-300 text-sm">
   {result.reasons.map((r:string,i:number)=>(
    <li key={i} className="flex gap-2">
      <span className="text-blue-400">›</span> {r}
    </li>
   ))}
  </ul>
 </div>

 {/* Coaching Pack [cite: 41] */}
 {result.classification==="Sales Call" && result.coaching_pack && (
 <>
 <Section title="What Went Well" items={result.coaching_pack.what_went_well} color="text-emerald-400"/>
 <Section title="Improvements" items={result.coaching_pack.improvements} color="text-amber-400"/>
 <Section title="Missed Questions" items={result.coaching_pack.missed_questions} color="text-purple-400"/>
 <Section title="Next Steps" items={result.coaching_pack.next_steps} color="text-blue-400"/>

 <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl">
  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">
   Follow-Up Email Draft
  </h3>
  <pre className="whitespace-pre-wrap text-slate-300 font-sans bg-slate-950/50 p-5 rounded-xl border border-slate-800/50 leading-relaxed text-sm">
   {result.coaching_pack.follow_up_email}
  </pre>

  {/* Buttons [cite: 42] */}
  <div className="flex flex-wrap gap-3 mt-5">
   <button
    onClick={copyEmail}
    className="bg-blue-600 hover:bg-blue-500 px-5 py-2 rounded-lg font-medium shadow-lg shadow-blue-500/20 transition text-sm"
   >
    {emailCopied ? "✓ Copied!" : "Copy Email"}
   </button>
   <button
    onClick={copyFeedback}
    className="bg-slate-800 hover:bg-slate-700 border border-slate-700 px-5 py-2 rounded-lg font-medium transition text-sm text-slate-300"
   >
    {feedbackCopied ? "✓ Copied!" : "Copy Feedback"}
   </button>
  </div>
 </div>
 </>
 )}

 </div>
 )}

 </main>
 </div>
 )
}

function Section({title, items, color}:{title:string, items:string[], color:string}){
 return(
 <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl">
  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">
   {title}
  </h3>
  <ul className="space-y-2 text-slate-300 text-sm">
  {items.map((i,index)=>(
   <li key={index} className="flex gap-2">
     <span className={color}>›</span> <span className="leading-relaxed">{i}</span>
   </li>
  ))}
  </ul>
 </div>
 )
}
