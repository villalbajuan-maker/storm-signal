"use client";

import { useState } from "react";
import "../expired.css";

function SignalMark() { return <span className="expired-mark" aria-hidden="true"><i /><i /><i /><b /></span>; }

export default function ExpiredWorkspace() {
  const [showHistory, setShowHistory] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"quarterly" | "annual" | null>(null);

  return <main className="expired-shell">
    <aside className="expired-side">
      <a href="/" className="expired-brand"><SignalMark /><b>Storm Signal</b></a>
      <button disabled>＋ New conversation</button>
      <p>RECENT WORK</p>
      <nav><a className="active" href="#history">Four hours from Fort Worth<small>Read only</small></a><a href="#history">Tulsa vs. Wichita<small>Read only</small></a><a href="#history">Montana hail · 48 hours<small>Read only</small></a></nav>
      <div className="expired-account"><span>TRIAL COMPLETE</span><b>Signal workspace</b><small>Your work is still here</small></div>
    </aside>

    <section className="expired-main">
      <header><div><SignalMark /><span>Trial complete</span></div><a href="/login">Account</a></header>
      <div className="expired-banner"><b>Your 7-day trial is complete.</b><span>Your work is still here.</span></div>

      {!showHistory ? <section className="expired-offer">
        <p>KEEP STORM SIGNAL WORKING</p>
        <h1>Keep asking when<br />the next storm hits.</h1>
        <span>Choose a plan to continue new investigations, comparisons, field plans, and briefs.</span>
        <div className="expired-plans">
          <button onClick={() => setSelectedPlan("quarterly")}><span><small>QUARTERLY</small><b>$399</b><em>every three months</em></span><strong>Continue quarterly ↗</strong></button>
          <button className="recommended" onClick={() => setSelectedPlan("annual")}><span><small>ANNUAL · BEST VALUE</small><b>$1,299</b><em>per year</em></span><strong>Continue annually ↗</strong></button>
        </div>
        {selectedPlan && <div className="billing-wireframe" role="status"><b>{selectedPlan === "annual" ? "Annual" : "Quarterly"} plan selected.</b><span>The production checkout will open here after billing is connected. No payment is processed in this wireframe.</span></div>}
        <button className="review-work" onClick={() => setShowHistory(true)}>Review past work instead</button>
        <small>Nothing you created during the trial will be removed when you choose a plan.</small>
      </section> : <section className="expired-history" id="history">
        <button onClick={() => setShowHistory(false)}>← Back to plan options</button>
        <p>FOUR HOURS FROM FORT WORTH</p>
        <h1>Your past work remains readable.</h1>
        <article><small>YOU</small><p>We&apos;re a four-person crew in Fort Worth. Where should we check within four hours?</p></article>
        <article><small>STORM SIGNAL</small><p>This saved investigation remains available in read-only mode. New weather checks and follow-up requests resume after a plan is activated.</p></article>
      </section>}

      <div className="expired-composer"><span>Choose a plan to continue asking Storm Signal.</span><button disabled aria-label="Sending is unavailable while trial is expired">↑</button></div>
    </section>
  </main>;
}
