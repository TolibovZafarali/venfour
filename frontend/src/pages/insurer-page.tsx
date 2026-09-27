import { useLoaderData } from "react-router";
import { InsurerGuide } from "@/features/insurers/insurer-guide";
import { NotFoundPage } from "@/pages/not-found-page";
import { PublicReviewAction } from "@/pages/public-page-actions";
import type { insurerPageLoader } from "./insurer-page-loader";

export function InsurerPage() {
  const guide = useLoaderData<typeof insurerPageLoader>();
  if (!guide) return <NotFoundPage />;
  const action = <PublicReviewAction className="state-page__action bg-neutral-900 hover:bg-neutral-700" />;
  return <InsurerGuide key={guide.insurer.slug} insurer={guide.insurer} content={guide.content} action={action} />;
}
