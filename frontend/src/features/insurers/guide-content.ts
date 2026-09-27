import type { GuideParagraph, GuideSource, GuideTopic } from "../states/guide-content";
import type { Insurer } from "./insurers";

export interface InsurerGuideContent {
  slug: Insurer["slug"];
  checkedOn: string;
  documents: readonly GuideParagraph[];
  valuation: readonly GuideParagraph[];
  reconsideration: readonly GuideParagraph[];
  faqs: readonly GuideTopic[];
  sources: readonly GuideSource[];
}
