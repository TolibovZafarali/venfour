import copy from "../../../templates/total-loss-reconsideration-email.json";

// The offline preview supplies fictional, already selected facts. Production
// selects facts and findings from the immutable report inside the database.
export interface ReconsiderationPreviewFacts {
  claimNumber: string | null;
  adjusterName: string | null;
  yearMakeModel: string;
  trim: string | null;
  insurerAmountMinorUnits: number | null;
  customerName: string | null;
  customerPhone: string | null;
  findingCode: keyof typeof copy.findings | null;
}

function format(template: string, ...values: string[]) {
  let index = 0;
  return template.replace(/%s/gu, () => values[index++]);
}

export function renderReconsiderationPreview(facts: ReconsiderationPreviewFacts) {
  const firstName = facts.adjusterName?.trim().split(/\s+/u)[0];
  const knownFirstName = firstName && /^[\p{L}][\p{L}'’-]+$/u.test(firstName) &&
    !/^(mr|mrs|ms|dr|claims|adjuster|representative)$/iu.test(firstName);
  const vehicle = [facts.yearMakeModel, facts.trim].filter(Boolean).join(" ");
  const amount = facts.insurerAmountMinorUnits === null ? null : new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
  }).format(facts.insurerAmountMinorUnits / 100);
  return {
    subject: facts.claimNumber ? format(copy.subjectWithClaim, facts.claimNumber)
      : format(copy.subjectWithoutClaim, facts.yearMakeModel),
    body: [
      knownFirstName ? format(copy.greeting, firstName) : copy.greetingWithoutName,
      copy.opening,
      amount ? format(copy.request, amount, vehicle) : format(copy.requestWithoutAmount, vehicle),
      facts.findingCode ? copy.findings[facts.findingCode] : null,
      copy.reviewRequest,
      copy.thanks,
      [copy.signoff, facts.customerName, facts.customerPhone].filter(Boolean).join("\n"),
    ].filter(Boolean).join("\n\n"),
  };
}
