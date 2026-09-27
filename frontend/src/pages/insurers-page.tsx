import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { publicHref } from "@/app/site-boundary";
import { insurers, insurerPath } from "@/features/insurers/insurers";
import { publicTextLinkClassName } from "@/pages/public-page";

export function InsurersPage() {
  return <article className="state-page state-page--guide insurers-directory">
    <div className="public-page-container state-page__inner">
      <nav className="state-guide__breadcrumb" aria-label="Breadcrumb"><Link to={publicHref("/")}>Home</Link><span aria-hidden>/</span><span>Insurance companies</span></nav>
      <header className="state-page__header insurers-directory__header">
        <span className="states-eyebrow">Insurance companies</span>
        <h1>Find your insurer’s total-loss guide.</h1>
        <p className="state-guide__lede">Start with the company handling your claim. Find practical steps for getting your documents, understanding the valuation, and asking for a review.</p>
        <p className="state-guide__lede">For AAA, check the insurance company on your policy or claim letter before choosing a guide.</p>
        <p className="insurer-guide__independence">Venfour is independent and is not affiliated with or endorsed by these insurance companies.</p>
      </header>
      <nav aria-label="Insurer guides" className="insurers-directory__list">
        <ul>{insurers.map(insurer => <li key={insurer.slug}>
          <Link to={publicHref(insurerPath(insurer))} className="insurers-directory__link">
            <div><h2>{insurer.name}</h2><p>{insurer.summary}</p></div>
            <ArrowRight size={20} aria-hidden />
          </Link>
        </li>)}</ul>
      </nav>
      <footer className="state-guide__notes">
        <p>Your policy, claim circumstances, and state requirements matter. <Link to={publicHref("/#states")} className={publicTextLinkClassName}>Find your state guide</Link> for local context.</p>
        <p>If your insurer is not listed, the <Link to={publicHref("/resources/valuation-review-checklist")} className={publicTextLinkClassName}>valuation review checklist</Link> can help you start with the details behind your offer.</p>
      </footer>
    </div>
  </article>;
}
