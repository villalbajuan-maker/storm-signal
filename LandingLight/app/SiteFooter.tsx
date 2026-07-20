function SignalMark() { return <span className="signal-mark" aria-hidden="true"><i /><i /><i /><b /></span>; }

export default function SiteFooter() {
  return <footer className="full-footer">
    <div className="footer-main">
      <div className="footer-intro"><a href="/" className="footer-logo" aria-label="Storm Signal home"><SignalMark /></a><h2>You ask.<br />We check.<br />You make the call.</h2></div>
      <div className="footer-details"><span>Storm Signal</span><span>Sarasota, Florida</span></div>
    </div>
    <div className="footer-bottom"><span>© 2026 Storm Signal. Built in good faith for crews making real decisions on the road.</span></div>
  </footer>;
}
