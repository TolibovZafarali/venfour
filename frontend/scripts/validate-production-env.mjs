import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { ProductionEnvironmentValidationError, validateProductionEnvironment } from "./production-environment.mjs";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const environment = { ...loadEnv("production", frontendRoot, "VENFOUR_"), ...loadEnv("production", frontendRoot, "VITE_") };

try {
  validateProductionEnvironment(environment);
  console.log("Production browser environment is valid.");
} catch (error) {
  if (!(error instanceof ProductionEnvironmentValidationError)) throw error;
  console.error("Production browser environment is invalid:");
  for (const issue of error.issues) console.error(`- ${issue}`);
  process.exitCode = 1;
}
