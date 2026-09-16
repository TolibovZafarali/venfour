import { Check } from "lucide-react";
import type { RefObject } from "react";

export function MessageStepHeading({ number, title, state, description, headingRef, id }: {
  readonly number: number;
  readonly title: string;
  readonly state: "active" | "complete" | "upcoming";
  readonly description?: string;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly id?: string;
}) {
  return <div className="message-step-heading">
    <span className="message-step-marker" aria-hidden="true">{state === "complete" ? <Check size={16} /> : number}</span>
    <div className="message-step-title"><h2 id={id} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{title}</h2>{description ? <p>{description}</p> : null}</div>
    <span className="message-step-status">{state === "active" ? "Current" : state === "complete" ? "Done" : "Next"}</span>
  </div>;
}

