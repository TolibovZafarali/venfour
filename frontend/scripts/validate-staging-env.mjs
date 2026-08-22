import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";

import {
  StagingEnvironmentValidationError,
  validateStagingEnvironment,
} from "./staging-environment.mjs";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const environment = loadEnv("staging", frontendRoot, "VITE_");

try {
  validateStagingEnvironment(environment);
  console.log("Staging browser environment is valid.");
} catch (error) {
  if (!(error instanceof StagingEnvironmentValidationError)) throw error;
  console.error("Staging browser environment is invalid:");
  for (const issue of error.issues) console.error(`- ${issue}`);
  process.exitCode = 1;
}
