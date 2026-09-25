import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { states, statePath } from "./states";
import { stateMapPaths } from "./map-paths";

export function StatesSection() {
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const [focusedState, setFocusedState] = useState<string | null>(null);
  const activeName = hoveredState ?? focusedState;

  return <section id="states" className="states-section section-anchor" aria-labelledby="states-title" tabIndex={-1}>
    <div className="home-section">
      <div className="states-section__heading">
        <p data-home-entrance="supporting" className="home-eyebrow">All 50 states. And D.C.</p>
        <h2 id="states-title" data-home-entrance="heading" data-anchor-heading>Nationwide support. Local clarity.</h2>
        <p data-home-entrance="copy" data-home-order="1">Venfour works nationwide. Choose your state to see how a free valuation and a full review work for you.</p>
      </div>
      <div data-home-entrance="visual" data-home-order="2">
        <svg className="states-map" viewBox="-5 -5 985 620" role="group" aria-label="United States map">
          {states.map(state => <Link
            key={state.code}
            to={statePath(state)}
            className="states-map__state"
            tabIndex={0}
            aria-label={state.name}
            onMouseEnter={() => setHoveredState(state.name)}
            onMouseLeave={() => setHoveredState(null)}
            onFocus={() => setFocusedState(state.name)}
            onBlur={() => setFocusedState(null)}
          >
            <title>{state.name}</title>
            <path d={stateMapPaths[state.code]} />
          </Link>)}
        </svg>
      </div>
      <div data-home-entrance="supporting" data-home-order="3" className="states-map__caption" aria-live="polite" aria-atomic="true">
        {activeName
          ? <span>{activeName} <ArrowRight size={14} aria-hidden /></span>
          : <Link to="/states/district-of-columbia">Washington, D.C. <ArrowRight size={14} aria-hidden /></Link>}
      </div>
    </div>
  </section>;
}
