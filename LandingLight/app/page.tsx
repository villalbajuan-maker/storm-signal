import DemoStory from "./DemoStory";
import MotionController from "./MotionController";
import SiteFooter from "./SiteFooter";
import "./band.css";

const outcomes = [
  ["01", "Know where to start.", "We narrow the recent storm evidence to the places that fit your crew and the distance you’re willing to drive."],
  ["02", "Know what to check.", "Turn the best-supported place into a clear field sequence: where to begin, what to verify, and what could change the call."],
  ["03", "Keep everyone on the same page.", "Leave with a field brief your crew, manager, or partner can open, share, and use."],
];

function SignalMark() { return <span className="signal-mark" aria-hidden="true"><i /><i /><i /><b /></span>; }

export default function Home() {
  return <>
    <MotionController />
    <header className="site-header"><a className="brand" href="/"><SignalMark /><b>Storm Signal</b></a><nav><a href="#product">How it works</a><a href="#pricing">Pricing</a><a href="/login">Sign in</a><a className="header-cta" href="/start">Try it free</a></nav></header>
    <main>
      <section className="hero">
        <div className="hero-copy"><p className="eyebrow">BUILT FOR ROOFING & RESTORATION CREWS</p><h1>Know which market is worth the <em>drive.</em></h1><p>Tell us where your crew is, how far you&apos;ll drive, and what kind of storm you&apos;re chasing. We&apos;ll show you where the recent evidence is strongest—before you burn a day on the road.</p><div className="hero-actions"><a className="primary" href="/start">Try it free for 7 days <span>↗</span></a><a className="text-link" href="#product">See a real example ↓</a></div><small>No credit card. No connector to install. Open the chat and ask.</small></div>
        <figure className="hero-photo"><figcaption><span>READY TO MOVE</span><b>Know where to check first.</b></figcaption></figure>
      </section>

      <section className="demo-stage" id="product"><div className="demo-intro"><p className="eyebrow">A REAL QUESTION. A USEFUL ANSWER.</p><h2>Say where you are.<br /><em>Say how far you&apos;ll drive.</em></h2><p>No filters to set. No weather map to learn. Ask the way you&apos;d ask someone on your crew. We check the recent evidence, cut out what doesn&apos;t fit, and help you decide what is worth checking first.</p></div><div className="demo-frame"><div className="motion-caption"><span>01</span><b>Fort Worth crew · Four-hour radius</b><small>Real example · July 19, 2026</small></div><DemoStory /></div></section>

      <section className="value-line"><b>You bring the crew.</b><b>We help make the miles count.</b></section>

      <section className="outcomes section-pad"><div className="section-head"><p className="eyebrow">FROM “WHERE DO WE GO?” TO “HERE&apos;S THE PLAN.”</p><h2>Know the next move.<br />Know why.</h2><p>We help you see where the evidence is strongest, choose what fits the day, and know what the crew should check when you get there.</p></div><div className="outcome-grid">{outcomes.map(([n,title,body])=><article key={n}><span>{n}</span><SignalMark /><h3>{title}</h3><p>{body}</p></article>)}</div></section>

      <section className="how section-pad"><div className="section-head compact"><p className="eyebrow">AS SIMPLE AS ASKING</p><h2>You know your crew.<br />We&apos;ll help you make the next call.</h2></div><div className="steps"><article><b>01</b><h3>Tell us where you&apos;re starting.</h3><p>Share where the crew is, how many people are ready, how far you&apos;ll drive, and what kind of storm you&apos;re chasing.</p></article><article><b>02</b><h3>We narrow what fits.</h3><p>We compare the recent reports, distance, and timing—then show you the places worth checking first and why.</p></article><article><b>03</b><h3>You make the call.</h3><p>Choose where to start, then ask us to turn it into a clear plan everyone on the crew can use.</p></article></div></section>

      <section className="truth-section section-pad"><div className="truth-label"><p className="eyebrow">TESTIMONIALS</p><span>00</span></div><div className="truth-copy"><h2>None yet.<br /><em>We don&apos;t claim work we haven&apos;t done.</em></h2><p>Storm Signal is new. We could fill this space with polished quotes that sound right. They wouldn&apos;t be earned—and that&apos;s not how we work.</p><p>Put it to work for 7 days with your real crew, your real market, and your next drive. Keep it only if it earns its keep.</p><a href="/start">Put it to work for 7 days <span>↗</span></a></div></section>

      <section className="pricing section-pad" id="pricing"><div className="section-head centered"><p className="eyebrow">7 DAYS. PUT IT TO WORK BEFORE YOU PAY.</p><h2>One better call can cover the year.</h2><p>We can&apos;t promise the job. We can help you stop burning time and money on places the evidence doesn&apos;t support—and start with the ones it does.</p></div><div className="price-grid"><article><span>QUARTERLY</span><h3>Run it through storm season.</h3><div className="price"><b>$399</b><small>every three months</small></div><p>For crews that want Storm Signal during the months they’re actively chasing weather.</p><a href="/start">Try it free for 7 days <b>↗</b></a></article><article className="featured"><span>ANNUAL · BEST VALUE</span><h3>Be ready for the next storm—and the one after.</h3><div className="price"><b>$1,299</b><small>per year</small></div><p>For crews that want a clear place to start checking whenever severe weather hits.</p><a href="/start">Try it free for 7 days <b>↗</b></a></article></div><div className="pricing-close"><p>NO CARD. FULL ACCESS. SEVEN DAYS.</p><h3>Put it against a real decision<br />before you spend a dollar.</h3><span>Use your crew, your drive limit, and a storm you actually care about. Then decide if it&apos;s worth keeping.</span></div></section>

      <section className="final-cta"><SignalMark /><p className="eyebrow">ONE QUESTION BEFORE THE NEXT DRIVE.</p><h2>Where should we<br />check first?</h2><a className="primary light" href="/start">Ask Storm Signal free for 7 days <span>↗</span></a><small>No card. Full access. We help you compare recent storm evidence; we don&apos;t confirm property damage or promise work.</small></section>
    </main>
    <SiteFooter />
  </>;
}
