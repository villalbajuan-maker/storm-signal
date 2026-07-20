"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "./verify.css";
import "./verify-auth.css";

type SignupIntent = { id: string; email: string; company?: string; market?: string; crewSize?: string; status: string; expiresAt: string; returnTo?: string };

function safeReturnTo(value?: string) {
  if (!value) return "/workspace";
  try {
    const candidate = new URL(value, window.location.origin);
    if (candidate.origin !== window.location.origin || ["/login", "/verify", "/start"].includes(candidate.pathname)) return "/workspace";
    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return "/workspace";
  }
}

function SignalMark() { return <span className="verify-mark" aria-hidden="true"><i /><i /><i /><b /></span>; }

function maskEmail(email: string) {
  const [name = "", domain = ""] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, Math.min(3, name.length))}${name.length > 3 ? "•••" : ""}@${domain}`;
}

export default function Verify() {
  const [intent, setIntent] = useState<SignupIntent | null>(null);
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState("");
  const [resending, setResending] = useState(false);
  const expired = Boolean(intent && new Date(intent.expiresAt).getTime() <= Date.now());
  const maskedEmail = useMemo(() => maskEmail(intent?.email || "your email"), [intent]);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("storm-signal-signup-intent");
      setIntent(stored ? JSON.parse(stored) : null);
    } catch { setIntent(null); }
  }, []);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setInterval(() => setSeconds((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);

  async function resend() {
    if (seconds > 0 || !intent || resending || expired) return;
    setResending(true);
    setError("");
    try {
      const returning = intent.status === "returning";
      const response = await fetch(returning ? "/api/auth/login" : "/api/auth/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(returning ? { email: intent.email } : { intentId: intent.id, email: intent.email }) });
      const result = (await response.json()) as { sent?: boolean; request?: unknown; error?: string };
      if (!response.ok || (!returning && !result.sent) || (returning && !result.request)) throw new Error(result.error || "We couldn't send another code.");
      setSeconds(60);
      setCode("");
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "We couldn't send another code.");
    } finally {
      setResending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!intent || ![6, 8].includes(code.length) || activating) return;
    setActivating(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: currentIdentity } = await supabase.auth.getUser();
      if (currentIdentity.user?.email?.toLowerCase() !== intent.email.toLowerCase()) {
        const { error: verifyError } = await supabase.auth.verifyOtp({ email: intent.email, token: code, type: "email" });
        if (verifyError) throw new Error("That code is invalid or has expired. Request another one and try again.");
      }

      if (intent.status === "returning") {
        sessionStorage.setItem("storm-signal-signup-intent", JSON.stringify({ ...intent, status: "authenticated", consumedAt: new Date().toISOString() }));
        window.location.href = safeReturnTo(intent.returnTo);
        return;
      }

      const { data, error: activationError } = await supabase.rpc("activate_trial", { p_signup_intent_id: intent.id });
      if (activationError || !data?.length) throw new Error("Your email was verified, but we couldn't open the workspace. Please try again.");

      sessionStorage.setItem("storm-signal-signup-intent", JSON.stringify({ ...intent, status: "consumed", consumedAt: new Date().toISOString(), workspaceId: data[0].workspace_id }));
      sessionStorage.removeItem("storm-signal-prototype-session");
      sessionStorage.removeItem("storm-signal-trial");
      window.location.href = "/workspace";
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : "We couldn't verify that code.");
      setActivating(false);
    }
  }

  if (!intent) return <main className="verify-missing"><SignalMark /><p>There isn&apos;t an access code waiting for verification.</p><a href="/start">Return to trial setup →</a></main>;
  if (expired) return <main className="verify-missing"><SignalMark /><p>This access request has expired. Your trial has not started.</p><a href={intent.status === "returning" ? "/login" : "/start"}>Request a new code →</a></main>;

  return <main className="verify-page">
    <section className="verify-brand-panel">
      <a href="/" className="verify-brand"><SignalMark /><b>Storm Signal</b></a>
      <div><p>ONE STEP LEFT</p><h1>Your workspace<br />starts with a<br /><em>verified crew.</em></h1></div>
      <small>Your seven days begin only after the code is verified.</small>
    </section>
    <section className="verify-form-panel">
      <form onSubmit={submit}>
        <p className="verify-eyebrow">CHECK YOUR EMAIL</p>
        <h2>Enter your code.</h2>
        <p>We sent a verification code to <b>{maskedEmail}</b>. Enter it below to {intent.status === "returning" ? "open your workspace" : "start your 7-day trial"}.</p>
        <label htmlFor="verification-code">Email verification code</label>
        <input id="verification-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="00000000" autoFocus aria-describedby="prototype-code-note" />
        {error ? <p className="verify-error" role="alert">{error}</p> : null}
        <button disabled={![6, 8].includes(code.length) || activating}>{activating ? "Opening your workspace…" : "Verify and open workspace"}<span>{activating ? "" : "↗"}</span></button>
        <div className="verify-actions"><button type="button" onClick={resend} disabled={seconds > 0 || resending}>{resending ? "Sending…" : seconds > 0 ? `Send another code in ${seconds}s` : "Send another code"}</button><a href="/start">Change email</a></div>
        <small id="prototype-code-note">Use the code sent by Storm Signal. Your trial starts only after Supabase verifies it.</small>
      </form>
    </section>
  </main>;
}
