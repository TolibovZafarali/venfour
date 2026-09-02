import { createContext, useContext } from "react";

export const CompletedReviewProgressHostContext =
  createContext<HTMLElement | null>(null);

export function useCompletedReviewProgressHost() {
  return useContext(CompletedReviewProgressHostContext);
}
