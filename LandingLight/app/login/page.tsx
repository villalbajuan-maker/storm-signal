"use client";

import { FormEvent, useEffect, useState } from "react";
import "./login.css";
import "./login-auth.css";

function SignalMark() { return <span className="login-mark" aria-hidden="true"><i /><i /><i /><b /></span>; }

export default function Login() {
  const [email, setEmail] = useState("");
  const [returnTo, setReturnTo] = useState("/workspace");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("returnTo") || "/workspace";
    let safeTarget = "/workspace";
    try {
      const candidate = new URL(requested, window.location.origin);
      if (candidate.origin === window.location.origin && !["/login", "/verify", "/start"].includes(candidate.pathname)) safeTarget = `${candidate.pathname}${candidate.search}${candidate.hash}`;
    } catch { /* Use the workspace fallback. */ }
    setReturnTo(safeTarget);
    fetch("/api/auth/session").then((response) => response.json()).then((session) => {
      if (session.authenticated) window.location.replace(safeTarget);
    }).catch(() => undefined);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const result = (await response.json()) as { request?: Record<string, unknown>; error?: string };
      if (!response.ok || !result.request) throw new Error(result.error || "We couldn't send the access code.");
      sessionStorage.setItem("storm-signal-signup-intent", JSON.stringify({ ...result.request, returnTo }));
      window.location.href = "/verify?mode=login";
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We couldn't send the access code.");
      setSubmitting(false);
    }
  }
  return <main className="login-page">
    <section className="login-brand-panel">
      <a href="/" className="login-brand"><SignalMark /><b>Storm Signal</b></a>
      <div><p>YOUR BASE BEFORE THE NEXT DRIVE</p><h1>Pick up where<br />the crew left off.</h1><span>Your investigations, plans, and field briefs will live in one company workspace.</span></div>
      <small>Built for better field decisions—not blind miles.</small>
    </section>
    <section className="login-form-panel">
      <form onSubmit={submit}><p className="login-eyebrow">RETURN TO YOUR WORKSPACE</p><h2>Pick up where you left off.</h2><p>Enter your work email. We&apos;ll send a one-time code—no password to remember.</p><label>Work email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required autoFocus /></label>{error ? <p className="login-error" role="alert">{error}</p> : null}<button disabled={submitting}>{submitting ? "Sending your code…" : "Send my access code"}<span>{submitting ? "" : "↗"}</span></button><small>If the email belongs to a Storm Signal workspace, the code will arrive shortly.</small></form>
      <a href="/start" className="login-trial">New to Storm Signal? <b>Start your 7-day trial →</b></a>
    </section>
  </main>;
}
