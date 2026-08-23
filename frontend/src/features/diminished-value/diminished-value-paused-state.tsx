import { ArrowRight, Clock3 } from "lucide-react";
import { Link } from "react-router";

import {
  FlowCard,
  primaryFlowButtonClassName,
} from "@/features/total-loss/intake-fields";

export function DiminishedValuePausedState() {
  return (
    <FlowCard className="text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Clock3 className="size-6" aria-hidden />
      </span>
      <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-brand uppercase">
        Service update
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-ink sm:text-3xl">
        Diminished Value intake is not open yet
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-copy">
        Diminished Value remains part of Venfour. We’re completing the Total
        Loss experience before opening this service to customers.
      </p>
      <Link
        className={`${primaryFlowButtonClassName} mt-7`}
        to="/start?service=total-loss"
      >
        Start a Total Loss review
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </FlowCard>
  );
}
