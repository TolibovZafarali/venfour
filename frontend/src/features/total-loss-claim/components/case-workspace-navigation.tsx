import { Check, Circle } from "lucide-react";
import { useId } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router";

import { useCompletedReviewNavigationHost } from "@/components/completed-review-progress-host";
import type { TotalLossCaseJourneyStage } from "../case-journey";
import type { CaseWorkspace } from "../case-workspace";
import "./case-workspace-navigation.css";

export function CaseWorkspaceNavigation({ workspace, stage, pending }: {
  readonly workspace: CaseWorkspace;
  readonly stage: TotalLossCaseJourneyStage;
  readonly pending: boolean;
}) {
  const selectId = useId();
  const navigate = useNavigate();
  const navigationHost = useCompletedReviewNavigationHost();
  const selected = workspace.sections.find((section) => section.stage === stage);

  const navigation = (
    <nav className="case-workspace-navigation" aria-label="Case sections">
      <ol className="case-workspace-sections" style={{ gridTemplateColumns: `repeat(${workspace.sections.length}, minmax(0, 1fr))` }}>
        {workspace.sections.map((section) => (
          <li key={section.stage} data-current={section.current || undefined}>
            {section.available ? (
              <Link
                to={section.href}
                aria-current={section.stage === stage ? "page" : undefined}
                aria-disabled={pending || undefined}
                onClick={(event) => { if (pending) event.preventDefault(); }}
              >
                {section.complete ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
                {section.label}
              </Link>
            ) : (
              <span className="case-workspace-unavailable"><Circle aria-hidden="true" />{section.label}</span>
            )}
          </li>
        ))}
      </ol>
      <div className="case-workspace-mobile">
        <label className="sr-only" htmlFor={selectId}>Case section</label>
        <select id={selectId} value={selected?.stage ?? ""} disabled={pending} onChange={(event) => {
          const section = workspace.sections.find((item) => item.stage === event.target.value);
          if (section?.available) navigate(section.href);
        }}>
          {!selected ? <option value="" disabled>{stage === "response" ? "Record insurer response" : "Choose a section"}</option> : null}
          {workspace.sections.map((section) => (
            <option key={section.stage} value={section.stage} disabled={!section.available}>
              {section.label}{section.current ? " — current" : section.complete ? " — complete" : ""}
            </option>
          ))}
        </select>
      </div>
    </nav>
  );
  return navigationHost ? createPortal(navigation, navigationHost) : navigation;
}
