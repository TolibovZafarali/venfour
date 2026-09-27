import { ArrowRight } from "lucide-react";
import { Link, useLoaderData } from "react-router";
import { applicationHref } from "@/app/site-boundary";
import { publicIntakeClosed } from "@/config/public-site";
import { StateGuide } from "@/features/states/state-guide";
import { NotFoundPage } from "@/pages/not-found-page";
import type { statePageLoader } from "./state-page-loader";

export function StatePage() {
  const guide = useLoaderData<typeof statePageLoader>();
  if (!guide) return <NotFoundPage />;
  const action = <Link className="state-page__action" to={publicIntakeClosed ? "/contact" : applicationHref("/start?service=total-loss")}>
    {publicIntakeClosed ? "Contact Venfour" : "Start my free valuation"}<ArrowRight size={16} aria-hidden />
  </Link>;
  return <StateGuide key={guide.state.code} state={guide.state} content={guide.content} action={action} />;
}
