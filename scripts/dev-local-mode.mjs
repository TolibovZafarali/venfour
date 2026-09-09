export function localDevelopmentMode(args, environment) {
  if (args.some((arg) => !["--full-flow", "--mock-market"].includes(arg)) || args.length > 1) {
    throw new Error("Use node scripts/dev-local.mjs [--full-flow | --mock-market].");
  }
  const marketFixtures = args.includes("--mock-market");
  const fullFlow = args.includes("--full-flow") || environment.VENFOUR_LOCAL_FULL_FLOW === "1";
  const fixtures = marketFixtures || environment.VENFOUR_LOCAL_POST_CONTINUE === "1";
  if (fullFlow && fixtures) throw new Error("Choose full-flow development or synthetic fixtures, not both.");
  if (marketFixtures && environment.VENFOUR_LOCAL_STRIPE_CHECKOUT === "1") throw new Error("Market fixtures require local synthetic payments.");
  return { fullFlow, fixtures, continuation: fullFlow || fixtures, ...(marketFixtures ? { marketFixtures: true } : {}) };
}
