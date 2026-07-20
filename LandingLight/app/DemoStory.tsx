"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

const LAST_STEP = 15;

function Message({ role, children }: { role: "user" | "assistant"; children: ReactNode }) {
  return <article className={`story-message ${role}`}><span>{role === "user" ? "YOU" : "STORM SIGNAL"}</span>{children}</article>;
}

export default function DemoStory() {
  const [step, setStep] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const reveal = window.setTimeout(() => setStep(LAST_STEP), 0);
      return () => window.clearTimeout(reveal);
    }
    const timer = window.setInterval(() => setStep((value) => value >= LAST_STEP ? 0 : value + 1), 2200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    if (step === 0) element.scrollTo({ top: 0, behavior: "auto" });
    else element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [step]);

  return <div className="story-shell" aria-label="Example Storm Signal conversation">
    <div className="story-top"><span><i /> Storm Signal</span><small>Storm intelligence</small></div>
    <div className="story-viewport" ref={viewport}><div className="story-track">
      <Message role="user"><p>We&apos;re a four-person crew in 76102. We can drive up to four hours. Where should we look today?</p></Message>
      {step >= 1 && <Message role="assistant"><p>Got it — four people, Fort Worth, four-hour limit.</p></Message>}
      {step === 2 && <Message role="assistant"><div className="evidence-status"><b>◎</b><p>Checking recent storm reports</p><i /><i /><i /></div></Message>}
      {step >= 3 && <Message role="assistant"><div className="answer-message"><h3>I found two markets inside your drive limit worth field-verifying first.</h3><ol><li><strong>Childress, TX — First option</strong><p>Strongest measured wind report within your travel limit.</p></li><li><strong>Kiowa County, OK — Strong alternate</strong><p>Repeated observations and more room for a same-day return.</p></li><li><strong>Garza County, TX — Outside your limit</strong><p>Relevant evidence, but likely beyond four hours by road.</p></li></ol><small>Preliminary reports support field investigation. They do not confirm roof damage or available work.</small></div></Message>}
      {step >= 4 && <Message role="user"><p>Why Childress over Kiowa County?</p></Message>}
      {step >= 5 && <Message role="assistant"><p>Childress has the strongest measured wind report in the feasible set. Kiowa County has repeated reports and a shorter drive, but lower observed intensity.</p><p className="story-follow">If same-day return matters more than report strength, I&apos;d reverse the order.</p></Message>}
      {step >= 6 && <Message role="user"><p>What if I split the crew into two teams?</p></Message>}
      {step >= 7 && <Message role="assistant"><p>Send two people to Childress and two to Kiowa County. Team A takes the stronger report. Team B gets the easier same-day window.</p></Message>}
      {step >= 8 && <Message role="user"><p>Build the day around that.</p></Message>}
      {step === 9 && <Message role="assistant"><div className="evidence-status"><b>◎</b><p>Building the field plan</p><i /><i /><i /></div></Message>}
      {step >= 10 && <Message role="assistant"><div className="plan-summary"><h3>Two-team field plan</h3><p><b>Team A · Childress</b> — verify closest to the report point first.</p><p><b>Team B · Kiowa County</b> — work the shorter route and preserve return time.</p><small>Both teams: confirm local conditions before commercial action.</small></div></Message>}
      {step >= 11 && <Message role="user"><p>Make me a brief I can send to the crew.</p></Message>}
      {step === 12 && <Message role="assistant"><div className="evidence-status"><b>◎</b><p>Preparing your field brief</p><i /><i /><i /></div></Message>}
      {step >= 13 && <Message role="assistant"><p>Your field brief is ready.</p><div className="brief-card"><div className="pdf-mark">PDF</div><div><b>Fort Worth Deployment</b><span>2 markets · 2 crew assignments · 4 verification steps</span><small>Field brief · July 19, 2026</small></div><em>Prepared</em></div></Message>}
      {step >= 14 && <Message role="user"><p>Perfect. Thank you.</p></Message>}
      {step >= 15 && <Message role="assistant"><p>You&apos;re ready. If conditions change, come back and I&apos;ll update the plan.</p></Message>}
    </div></div>
    <div className="story-composer"><span>Ask Storm Signal…</span><b>↑</b></div>
  </div>;
}
