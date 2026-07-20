"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import "./start.css";
import "./start-auth.css";
import "./parallax.css";

const markets = ["Texas", "Florida", "Louisiana", "Georgia", "North Carolina"];

export default function Start() {
  const visual = useRef<HTMLElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("reason") === "no-workspace") setNotice("Your email is verified, but it is not connected to a Storm Signal workspace. Start a trial or ask your workspace owner for access.");
    const element = visual.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const progress = Math.max(-1, Math.min(1, (window.innerHeight / 2 - (rect.top + rect.height / 2)) / window.innerHeight));
      element.style.setProperty("--start-parallax", `${progress * 28}px`);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const payload = {
      email: String(data.get("email") || "").trim().toLowerCase(),
      company: String(data.get("company") || "").trim(),
      market: String(data.get("market") || ""),
      crewSize: String(data.get("teamSize") || ""),
    };
    try {
      const response = await fetch("/api/auth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = (await response.json()) as { intent?: unknown; error?: string };
      if (!response.ok || !result.intent) throw new Error(result.error || "We couldn't send the access code.");
      sessionStorage.setItem("storm-signal-signup-intent", JSON.stringify(result.intent));
      window.location.href = "/verify";
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We couldn't send the access code.");
      setSubmitting(false);
    }
  }

  return <main className="start-page">
    <section className="start-copy" ref={visual}>
      <a href="/" className="start-brand">← Storm Signal</a>
      <div className="start-message"><p className="eyebrow">PUT IT TO WORK FOR 7 DAYS.</p><h1>Start with the decision already on your <em>mind.</em></h1><p>Tell us where your crew works. Once your workspace opens, ask the real question: where should we check first?</p><div className="start-promises"><span>No card.</span><span>Full access.</span><span>Your real market.</span></div></div>
      <small className="photo-note">Built for the mornings when the crew is ready—but the direction is not.</small>
    </section>
    <section className="start-panel"><form onSubmit={submit}>
      <p className="eyebrow">OPEN YOUR WORKSPACE</p><h2>Tell us where the crew starts.</h2>
      {notice ? <p className="start-notice" role="status">{notice}</p> : null}
      <label>Work email<input name="email" type="email" placeholder="you@company.com" required /></label>
      <label>Company<input name="company" placeholder="Company name" required /></label>
      <label>Primary market<select name="market" defaultValue="" required><option value="" disabled>Select your primary market</option>{markets.map((market) => <option key={market}>{market}</option>)}</select></label>
      <label>Crew size<select name="teamSize" defaultValue="2-5"><option>1</option><option>2-5</option><option>6-15</option><option>16+</option></select></label>
      {error ? <p className="start-error" role="alert">{error}</p> : null}
      <button disabled={submitting}>{submitting ? "Sending your code…" : "Send my access code"}<span>{submitting ? "" : "↗"}</span></button><small>We&apos;ll email you a one-time code. Your trial starts only after you verify it.</small>
    </form></section>
  </main>;
}
