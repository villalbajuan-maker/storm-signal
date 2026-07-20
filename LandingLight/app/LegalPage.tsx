import SiteFooter from "./SiteFooter";

export default function LegalPage({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: React.ReactNode }) {
  return <><header className="legal-header"><a href="/">← Storm Signal</a><a href="/start">Start free for 7 days ↗</a></header><main className="legal-page"><div className="legal-lead"><p>{eyebrow}</p><h1>{title}</h1><span>{intro}</span></div><article className="legal-body">{children}</article></main><SiteFooter /></>;
}
