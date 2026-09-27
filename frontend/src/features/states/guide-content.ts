import type { State } from "./states";

export interface GuideParagraph {
  text: string;
  sources?: readonly string[];
  contact?: { label: string; href: `tel:${string}` };
}

export interface GuideTopic {
  title: string;
  paragraphs: readonly GuideParagraph[];
}

export interface GuideSource {
  id: string;
  title: string;
  url: string;
  locator: string;
  checkedOn: string;
  claims: readonly string[];
  applicability: string;
  effectiveOn?: string;
}

export interface StateGuideContent {
  code: State["code"];
  description: string;
  checkedOn: string;
  valuation: readonly GuideParagraph[];
  rules: readonly GuideTopic[];
  reconsideration: readonly GuideParagraph[];
  faqs: readonly GuideTopic[];
  sources: readonly GuideSource[];
}
