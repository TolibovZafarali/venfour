import { ArrowRight } from "lucide-react";
import { Link, useLoaderData } from "react-router";
import { applicationHref } from "@/app/site-boundary";
import { publicIntakeClosed } from "@/config/public-site";
import { InsurerGuide } from "@/features/insurers/insurer-guide";
import { NotFoundPage } from "@/pages/not-found-page";
import type { insurerPageLoader } from "./insurer-page-loader";

export function InsurerPage() {
  const guide = useLoaderData<typeof insurerPageLoader>();
  if (!guide) return <NotFoundPage />;
  const action = <Link className="state-page__action" to={publicIntakeClosed ? "/contact" : applicationHref("/start?service=total-loss")}>
    {publicIntakeClosed ? "Contact Venfour" : "Start my free valuation"}<ArrowRight size={16} aria-hidden />
  </Link>;
  return <InsurerGuide key={guide.insurer.slug} insurer={guide.insurer} content={guide.content} action={action} />;
}
