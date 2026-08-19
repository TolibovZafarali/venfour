export const APPRAISAL_SERVICE_SLUGS = [
  "total-loss",
  "diminished-value",
] as const;

export type AppraisalServiceSlug = (typeof APPRAISAL_SERVICE_SLUGS)[number];
