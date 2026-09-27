import type { StateGuideContent } from "./guide-content";
import type { State } from "./states";

const guideModules = import.meta.glob<{ default: StateGuideContent }>("./guides/*.ts");

export async function loadStateGuide(state: State): Promise<StateGuideContent> {
  const load = guideModules[`./guides/${state.slug}.ts`];
  if (!load) throw new Error(`Missing state guide: ${state.code}`);
  const { default: content } = await load();
  if (content.code !== state.code) throw new Error(`Mismatched state guide: ${state.code}`);
  return content;
}
