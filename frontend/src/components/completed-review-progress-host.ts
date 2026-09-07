import { createContext, useContext } from "react";

export const CompletedReviewProgressHostContext =
  createContext<HTMLElement | null>(null);

export const CompletedReviewNavigationHostContext =
  createContext<HTMLElement | null>(null);

export const CompletedReviewActionsHostContext =
  createContext<HTMLElement | null>(null);

export function useCompletedReviewActionsHost() {
  return useContext(CompletedReviewActionsHostContext);
}

export function useCompletedReviewProgressHost() {
  return useContext(CompletedReviewProgressHostContext);
}

export function useCompletedReviewNavigationHost() {
  return useContext(CompletedReviewNavigationHostContext);
}
