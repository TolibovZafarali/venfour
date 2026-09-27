import type { InsurerGuideContent } from "./guide-content";
import type { Insurer } from "./insurers";

const guideModules = import.meta.glob<{ default: InsurerGuideContent }>("./guides/*.ts");

export async function loadInsurerGuide(insurer: Insurer): Promise<InsurerGuideContent> {
  const load = guideModules[`./guides/${insurer.slug}.ts`];
  if (!load) throw new Error(`Missing insurer guide: ${insurer.slug}`);
  const { default: content } = await load();
  if (content.slug !== insurer.slug) throw new Error(`Mismatched insurer guide: ${insurer.slug}`);
  return content;
}
