export const insurers = [
  {
    name: "Allstate",
    slug: "allstate",
    summary: "Review your valuation, share evidence through MyClaim, and understand title paperwork.",
    description: "Understand an Allstate total-loss offer, review the valuation, organize corrections through MyClaim, and separate title paperwork from settlement questions.",
  },
  {
    name: "Farmers",
    slug: "farmers",
    summary: "Request the valuation report and organize supporting documents for reconsideration.",
    description: "Review a Farmers total-loss valuation, request the complete report, submit supporting records, and understand questions to ask about reconsideration.",
  },
  {
    name: "GEICO",
    slug: "geico",
    summary: "Contact your Auto Damage Adjuster and review vehicle details, comparables, and payment questions.",
    description: "Understand a GEICO total-loss offer, contact your Auto Damage Adjuster, check vehicle details and comparables, and prepare a clear request for review.",
  },
  {
    name: "Liberty Mutual",
    slug: "liberty-mutual",
    summary: "Ask your Total Loss Adjuster for the evaluation and confirm the process for your claim.",
    description: "Review a Liberty Mutual total-loss evaluation, ask for supporting documents, and distinguish your own-policy process from a claim against another driver.",
  },
  {
    name: "Nationwide",
    slug: "nationwide",
    summary: "Read the detailed valuation report and keep review, lender, and title questions organized.",
    description: "Understand a Nationwide total-loss report, examine comparable vehicles and adjustments, and organize valuation questions alongside lender and title paperwork.",
  },
  {
    name: "Progressive",
    slug: "progressive",
    summary: "Understand comparable-vehicle inputs, title documents, and questions for your claims representative.",
    description: "Review a Progressive total-loss offer, check comparable-vehicle inputs, prepare corrections, and clarify title paperwork and rental timing with your claims rep.",
  },
  {
    name: "State Farm",
    slug: "state-farm",
    summary: "Review the value with your claim associate and share records through the claims account or app.",
    description: "Understand a State Farm total-loss offer, request the valuation details, share supporting records, and prepare questions for your claim associate.",
  },
  {
    name: "USAA",
    slug: "usaa",
    summary: "Review the inspection report and send supporting documents through My Claims Center.",
    description: "Review a USAA total-loss offer, understand its comparable-vehicle inputs, and use My Claims Center to ask questions and submit supporting documents.",
  },
] as const;

export type Insurer = typeof insurers[number];

export function findInsurer(slug: string | undefined): Insurer | undefined {
  return insurers.find(insurer => insurer.slug === slug);
}

export function insurerPath(insurer: Insurer) {
  return `/insurers/${insurer.slug}`;
}

export function insurerFromPath(pathname: string) {
  const match = /^\/insurers\/([a-z-]+)\/?$/.exec(pathname);
  return match ? findInsurer(match[1]) : undefined;
}

export function insurerMetadata(insurer: Insurer) {
  return {
    title: `${insurer.name} Total-Loss Guide & Valuation Review | Venfour`,
    description: insurer.description,
    canonical: `https://venfour.com${insurerPath(insurer)}`,
  };
}

export const insurerDirectoryMetadata = {
  title: "Insurance Company Total-Loss Guides | Venfour",
  description: "Find your insurer’s total-loss guide, learn which documents to request, and understand how to review your vehicle valuation and ask for corrections.",
  canonical: "https://venfour.com/insurers",
} as const;
