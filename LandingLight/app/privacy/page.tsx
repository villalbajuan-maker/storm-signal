import LegalPage from "../LegalPage";

export default function Privacy() { return <LegalPage eyebrow="PRE-LAUNCH PRIVACY NOTICE" title="Privacy, in plain language." intro="This notice describes the current Storm Signal prototype. It must be reviewed and updated before commercial launch as accounts, billing, analytics, and support systems are added.">
  <p className="legal-note">Today, the trial form stores the information you enter only in this browser. The prototype does not yet create a persistent customer account or process a payment.</p>
  <h2>What you may provide</h2><p>The prototype may receive your work email, company name, selected primary market, crew size, and the questions you submit in the Storm Signal chat.</p>
  <h2>How the chat works</h2><p>Your chat requests are sent through the Storm Signal server to the language-model and weather-data services required to answer them. Do not submit confidential customer records, property-owner information, payment information, claim files, or other sensitive personal data.</p>
  <h2>How we use information</h2><ul><li>To provide and improve the Storm Signal experience.</li><li>To answer questions and investigate technical problems.</li><li>To protect the service from misuse.</li><li>To communicate about the product when you have asked us to do so.</li></ul>
  <h2>Before launch</h2><p>The final policy will identify the operating company, contact channel, service providers, retention periods, available privacy requests, and the jurisdictions that apply.</p>
</LegalPage>; }
