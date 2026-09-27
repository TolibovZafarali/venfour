import type { LoaderFunctionArgs } from "react-router";
import { findInsurer } from "@/features/insurers/insurers";
import { loadInsurerGuide } from "@/features/insurers/guide-loader";

export async function insurerPageLoader({ params }: LoaderFunctionArgs) {
  const insurer = findInsurer(params.insurerSlug);
  if (!insurer) return null;
  return { insurer, content: await loadInsurerGuide(insurer) };
}
