"use client"

import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"

export default function OwnerAccess({ authenticated, onChange }: { authenticated: boolean; onChange: (value: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/owner-session", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (response.ok) onChange((await response.json()).authenticated === true) })
      .catch(() => {})
    return () => controller.abort()
  }, [onChange])

  function open() {
    setError("")
    form.current?.reset()
    dialog.current?.showModal()
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submittedForm = event.currentTarget
    const code = new FormData(submittedForm).get("code")
    setPending(true)
    setError("")
    try {
      const response = await fetch("/api/owner-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) })
      const data = await response.json()
      if (!response.ok) { setError(data.error || "Unable to sign in"); return }
      onChange(true)
      dialog.current?.close()
    } catch {
      setError("Unable to sign in. Please try again.")
    } finally {
      submittedForm.reset()
      setPending(false)
    }
  }

  async function logout() {
    setPending(true)
    setError("")
    try {
      const response = await fetch("/api/owner-session", { method: "DELETE" })
      if (!response.ok) { setError("Unable to sign out. Please try again."); return }
      onChange(false)
    } catch {
      setError("Unable to sign out. Please try again.")
    } finally {
      setPending(false)
    }
  }

  return <div className="mb-6 text-center">
    <p className="mb-2 text-sm text-slate-400">{authenticated ? "Owner access is active for this browser." : "A private AI workspace. The interface is public; analysis is owner-only."}</p>
    <button type="button" onClick={authenticated ? logout : open} disabled={pending} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50">
      {authenticated ? "Sign out" : "Owner access"}
    </button>
    {error && <p className="mt-2 text-sm text-rose-300" role="alert">{error}</p>}
    <dialog ref={dialog} aria-labelledby="owner-title" aria-describedby="owner-description" onClose={() => form.current?.reset()} className="w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-left text-slate-200 backdrop:bg-black/70">
      <h2 id="owner-title" className="text-xl font-bold">Owner access</h2>
      <p id="owner-description" className="mt-2 text-sm text-slate-400">Enter your private access code to use AI analysis for one hour.</p>
      <form ref={form} onSubmit={login} className="mt-5">
        <label htmlFor="owner-code" className="mb-2 block text-sm font-medium">Access code</label>
        <input id="owner-code" name="code" type="password" autoComplete="off" required maxLength={512} disabled={pending} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 outline-none focus:border-blue-400" />
        {error && <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" disabled={pending} onClick={() => dialog.current?.close()} className="rounded-lg border border-slate-700 px-4 py-2">Cancel</button>
          <button type="submit" disabled={pending} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold disabled:opacity-50">{pending ? "Signing in…" : "Unlock analysis"}</button>
        </div>
      </form>
    </dialog>
  </div>
}
