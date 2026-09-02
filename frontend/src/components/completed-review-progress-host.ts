import { createContext, useContext } from "react";

export const CompletedReviewProgressHostContext =
  createContext<HTMLElement | null>(null);

export const CompletedReviewNavigationHostContext =
  createContext<HTMLElement | null>(null);

export function useCompletedReviewProgressHost() {
  return useContext(CompletedReviewProgressHostContext);
}

export function useCompletedReviewNavigationHost() {
  return useContext(CompletedReviewNavigationHostContext);
}
