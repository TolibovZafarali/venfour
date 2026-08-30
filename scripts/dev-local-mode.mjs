export function localDevelopmentMode(args, environment) {
  if (args.some((arg) => arg !== "--full-flow") || args.length > 1) {
    throw new Error("Use node scripts/dev-local.mjs [--full-flow].");
  }
  const fullFlow = args.includes("--full-flow") || environment.VENFOUR_LOCAL_FULL_FLOW === "1";
  const fixtures = environment.VENFOUR_LOCAL_POST_CONTINUE === "1";
  if (fullFlow && fixtures) throw new Error("Choose full-flow development or synthetic fixtures, not both.");
  return { fullFlow, fixtures, continuation: fullFlow || fixtures };
}
