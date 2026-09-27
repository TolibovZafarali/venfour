export const insurers = [
  {
    name: "AAA (Auto Club Enterprises)",
    slug: "aaa-auto-club-enterprises",
    summary: "Request the detailed evaluation and check the identifiers behind comparable vehicles.",
    description: "Understand an AAA (Auto Club Enterprises) total-loss evaluation, verify comparable vehicles, and prepare evidence for your claims representative.",
  },
  {
    name: "AAA (CSAA Insurance Group)",
    slug: "aaa-csaa",
    summary: "Find CSAA claims assistance and ask how local market evidence supports your offer.",
    description: "Review an AAA (CSAA Insurance Group) total-loss offer, request valuation documents, and distinguish claim evidence from policy documents.",
  },
  {
    name: "AAA (The Auto Club Group)",
    slug: "aaa-auto-club-group",
    summary: "Confirm your AAA insurer and gather title, equipment, and repair records for review.",
    description: "Understand an AAA (The Auto Club Group) total-loss offer, contact your claim representative, and organize equipment and condition evidence.",
  },
  {
    name: "Allstate",
    slug: "allstate",
    summary: "Review your valuation, share evidence through MyClaim, and understand title paperwork.",
    description: "Understand an Allstate total-loss offer, review the valuation, organize corrections through MyClaim, and separate title paperwork from settlement questions.",
  },
  {
    name: "American Family",
    slug: "american-family",
    summary: "Use MyAccount or MyAmFam to follow your claim and request the complete valuation.",
    description: "Review an American Family total-loss offer, request the valuation behind it, and organize vehicle records alongside your MyAccount claim information.",
  },
  {
    name: "Amica",
    slug: "amica",
    summary: "Find customer and non-customer document uploads and separate inspection from valuation.",
    description: "Understand an Amica total-loss offer, use the appropriate document-upload pathway, and prepare a focused request to review your vehicle valuation.",
  },
  {
    name: "Auto-Owners",
    slug: "auto-owners",
    summary: "Find your claims representative through your agent, Online Access, or the claim tracker.",
    description: "Review an Auto-Owners total-loss offer, locate your claims representative, and request valuation documents through the appropriate claim pathway.",
  },
  {
    name: "COUNTRY Financial",
    slug: "country-financial",
    summary: "Contact your Total Loss Adjuster and separate vehicle value from title and rental questions.",
    description: "Understand a COUNTRY Financial total-loss offer, request the valuation from your Total Loss Adjuster, and prepare vehicle records for review.",
  },
  {
    name: "Erie",
    slug: "erie",
    summary: "Locate your claims handler, keep your records together, and ask for the valuation details.",
    description: "Review an Erie total-loss offer, find your claims handler, organize estimates and correspondence, and ask for a clear explanation of vehicle value.",
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
    name: "Hanover",
    slug: "hanover",
    summary: "Review the adjuster’s evaluation and confirm which policy options apply to your loss.",
    description: "Understand a Hanover total-loss offer, request the evaluation, check applicable policy options, and organize a courteous request for reconsideration.",
  },
  {
    name: "Kemper",
    slug: "kemper",
    summary: "Ask about document sharing and keep valuation, coverage, and payment questions distinct.",
    description: "Review a Kemper total-loss offer, ask your adjuster about document sharing, and prepare vehicle evidence for a clear valuation review request.",
  },
  {
    name: "Liberty Mutual",
    slug: "liberty-mutual",
    summary: "Ask your Total Loss Adjuster for the evaluation and confirm the process for your claim.",
    description: "Review a Liberty Mutual total-loss evaluation, ask for supporting documents, and distinguish your own-policy process from a claim against another driver.",
  },
  {
    name: "MAPFRE",
    slug: "mapfre",
    summary: "Work with your Total Loss Claim Representative and check the value and paperwork separately.",
    description: "Understand a MAPFRE total-loss offer, contact the Total Loss Claim Representative, and review vehicle details, comparable evidence, and settlement paperwork.",
  },
  {
    name: "Mercury",
    slug: "mercury",
    summary: "Find your claims representative and organize the records supporting your vehicle’s value.",
    description: "Review a Mercury total-loss offer, find your claims representative, request the valuation, and organize condition, equipment, and comparable evidence.",
  },
  {
    name: "Nationwide",
    slug: "nationwide",
    summary: "Read the detailed valuation report and keep review, lender, and title questions organized.",
    description: "Understand a Nationwide total-loss report, examine comparable vehicles and adjustments, and organize valuation questions alongside lender and title paperwork.",
  },
  {
    name: "NJM",
    slug: "njm",
    summary: "Check vehicle factors and comparable adjustments while keeping lender paperwork separate.",
    description: "Understand an NJM total-loss valuation, review comparable-vehicle adjustments, and prepare evidence alongside title, lender, and transportation questions.",
  },
  {
    name: "Progressive",
    slug: "progressive",
    summary: "Understand comparable-vehicle inputs, title documents, and questions for your claims representative.",
    description: "Review a Progressive total-loss offer, check comparable-vehicle inputs, prepare corrections, and clarify title paperwork and rental timing with your claims rep.",
  },
  {
    name: "Shelter",
    slug: "shelter",
    summary: "Reach the auto physical damage team and submit documents with your claim number.",
    description: "Review a Shelter total-loss offer, reach the appropriate claims team, send supporting documents, and prepare specific questions about the vehicle valuation.",
  },
  {
    name: "State Farm",
    slug: "state-farm",
    summary: "Review the value with your claim associate and share records through the claims account or app.",
    description: "Understand a State Farm total-loss offer, request the valuation details, share supporting records, and prepare questions for your claim associate.",
  },
  {
    name: "The Hartford",
    slug: "the-hartford",
    summary: "Choose the right claim pathway and present supporting evidence to your representative.",
    description: "Understand The Hartford’s total-loss offer, find policyholder or non-policyholder claim help, and prepare evidence for a review of the vehicle value.",
  },
  {
    name: "Travelers",
    slug: "travelers",
    summary: "Discuss market value with your Claim professional and organize enhancements and title records.",
    description: "Review a Travelers total-loss offer, request the market evaluation, document vehicle enhancements, and keep title and rental questions organized.",
  },
  {
    name: "USAA",
    slug: "usaa",
    summary: "Review the inspection report and send supporting documents through My Claims Center.",
    description: "Review a USAA total-loss offer, understand its comparable-vehicle inputs, and use My Claims Center to ask questions and submit supporting documents.",
  },
] as const;

export type Insurer = typeof insurers[number];

const footerInsurerSlugs = new Set<Insurer["slug"]>([
  "allstate", "american-family", "auto-owners", "erie", "farmers", "geico",
  "liberty-mutual", "nationwide", "progressive", "state-farm", "travelers", "usaa",
]);

export const footerInsurers = insurers.filter(insurer => footerInsurerSlugs.has(insurer.slug));

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
