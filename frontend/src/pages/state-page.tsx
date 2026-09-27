import { useLoaderData } from "react-router";
import { StateGuide } from "@/features/states/state-guide";
import { NotFoundPage } from "@/pages/not-found-page";
import { PublicReviewAction } from "@/pages/public-page-actions";
import type { statePageLoader } from "./state-page-loader";

export function StatePage() {
  const guide = useLoaderData<typeof statePageLoader>();
  if (!guide) return <NotFoundPage />;
  const action = <PublicReviewAction className="state-page__action bg-neutral-900 hover:bg-neutral-700" />;
  return <StateGuide key={guide.state.code} state={guide.state} content={guide.content} action={action} />;
}
