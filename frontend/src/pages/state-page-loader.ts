import type { LoaderFunctionArgs } from "react-router";
import { loadStateGuide } from "@/features/states/guide-loader";
import { findState } from "@/features/states/states";

export async function statePageLoader({ params }: LoaderFunctionArgs) {
  const state = findState(params.stateSlug);
  if (!state) return null;
  return { state, content: await loadStateGuide(state) };
}
