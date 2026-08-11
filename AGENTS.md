# Venfour repository instructions

## Purpose of this document

Treat this file as persistent product and engineering context for work in this
repository. It explains Venfour's current scope, longer-term direction, and the
boundaries that future implementation tasks must preserve. It is context, not a
backlog: do not implement a capability merely because it is described here.

For any specific task:

1. Implement only the requested scope.
2. Inspect and preserve existing Venfour contracts before changing a boundary.
3. Use this context to understand product intent and terminology.
4. Avoid unrelated feature additions.
5. Do not implement possible future capabilities unless the task explicitly
   requests them.
6. Report a genuine conflict between a request and the existing architecture
   instead of silently redesigning the system.

## Product and company context

Venfour is a consumer-facing auto-accident assistance platform. Its broader
purpose is to reduce the confusion, delay, information disadvantage, and
administrative burden people face after an auto accident.

Over time, Venfour can become the central place where a customer understands and
manages an accident case, keeps important documents and evidence organized,
tracks what is happening, understands available options and potential
compensation, and connects with appropriate professional help when necessary.

Potential future areas include:

- vehicle total-loss claims;
- vehicle valuation and appraisal evidence;
- property-damage claims;
- repair-related issues;
- diminished-value claims;
- rental and transportation issues;
- GAP and vehicle-loan matters;
- accident-related expenses;
- claim timelines and deadlines;
- insurance documents and correspondence;
- injury-case organization;
- medical and claim documentation;
- settlement and offer tracking;
- attorney discovery and professional assistance; and
- centralized accident-case document management.

Venfour may eventually evolve beyond self-service assistance into deeper
appraisal, advocacy, coordination, or professional-service capabilities where
appropriate.

These possibilities describe product direction. They should inform terminology,
architecture, reasonable extensibility, and the avoidance of obvious dead ends,
but they are not automatically requirements for an engineering task and must not
be represented as currently implemented.

## Current product

Venfour currently begins with a focused problem: **helping consumers understand
and evaluate total-loss vehicle valuations.**

A customer receives a valuation report from an insurance company, initially a
CCC report. These reports may contain:

- loss-vehicle information;
- comparable vehicles;
- vehicle values;
- condition adjustments;
- mileage adjustments;
- options or equipment adjustments;
- dealer information;
- valuation calculations; and
- other information an ordinary vehicle owner may have difficulty evaluating
  independently.

Venfour acts as an independent vehicle-valuation advisor for the customer. The
current product is designed to:

1. Understand the customer's insurance valuation report.
2. Extract and normalize important vehicle, valuation, comparable, and
   adjustment information.
3. Independently research relevant comparable vehicles.
4. Use historical market evidence when defensibly available.
5. Evaluate the quality and relevance of external comparables.
6. Compare independent evidence against the insurer or vendor valuation.
7. Identify meaningful discrepancies without overstating what the evidence
   proves.
8. Explain the result in understandable language.
9. Provide visual evidence and organized supporting documentation.
10. Make the customer substantially better informed when discussing the
    valuation with an insurance settlement adjuster.

The current experience is primarily **self-service advisory**. The customer
remains responsible for communicating with the insurer. Venfour provides the
evidence, understanding, documentation, visual explanations, and knowledge that
can make that discussion more informed and effective.

### Product identity

Current product:

> **Venfour is a self-service vehicle valuation advisor for total-loss claims.
> It reviews the insurer's valuation, independently researches market evidence,
> identifies meaningful discrepancies, and gives the vehicle owner clear
> explanations, visual evidence, and organized documentation they can use when
> discussing the settlement with their insurance adjuster.**

Broader company direction:

> **Venfour is building a consumer-side intelligence and assistance platform
> for navigating auto accidents and insurance claims with less confusion,
> better organization, stronger evidence, and better-informed decisions.**

## Product experience

Venfour should feel as though a knowledgeable vehicle-valuation advisor carefully
reviewed the customer's case and organized the important evidence for them.

It should not feel like:

- a generic PDF analyzer;
- a vehicle search engine;
- an insurance-company portal;
- an AI chatbot guessing at claim value; or
- a developer-oriented analytics dashboard.

A user reviewing a total-loss valuation should ultimately be able to understand:

- what their vehicle was valued at;
- how that valuation was constructed;
- what comparable vehicles were used;
- how adjustments affected those comparables;
- what independent market evidence Venfour found;
- how strong that evidence is;
- where meaningful discrepancies may exist;
- what facts support those observations;
- what limitations remain; and
- what they should understand when discussing the valuation with their adjuster.

## Evidence and conclusions

Venfour must distinguish facts from conclusions. For example, a comparable
vehicle advertised for $20,500 is evidence. That fact alone does not establish
that the insurance company legally owes the customer a particular additional
amount.

External advertised prices are evidence, not guaranteed transaction prices.
Remain conservative and explicit about uncertainty. Identify meaningful signals
without representing screening results as:

- legal entitlement;
- a guaranteed settlement amount;
- an independent appraisal when it is not one; or
- proof of insurer wrongdoing.

## AI and deterministic domain logic

AI is useful where interpretation is genuinely required, particularly document
understanding:

```text
Insurance valuation PDF
        ↓
AI-assisted document understanding
        ↓
strict structured data
        ↓
deterministic validation and analysis
```

Core evidence eligibility, comparable ranking, lifecycle verification,
discrepancy calculations, and classifications should remain deterministic when
deterministic contracts already exist. AI must not silently replace reproducible
domain logic with subjective conclusions.

## Provider independence

CCC and MarketCheck are current integrations, not definitions of the product.
CCC is the first supported valuation-report format. MarketCheck is the first
major source of independent market evidence.

Core Venfour contracts should remain sufficiently provider-neutral to support
additional valuation-report vendors, market-data providers, and evidence sources
without redesigning the product around one provider. Do not introduce
abstraction merely for theoretical extensibility, but do not unnecessarily
couple core domain logic to CCC or MarketCheck where a clean provider-neutral
boundary already exists.

## Current architecture and implementation state

The current backend is primarily Python. Its analysis pipeline is conceptually:

```text
Insurance valuation report
        ↓
structured report understanding
        ↓
canonical vehicle / valuation / CCC comparable data
        ↓
independent market discovery
        ↓
historical evidence verification where available
        ↓
provider-neutral comparable scoring and ranking
        ↓
deterministic discrepancy analysis
        ↓
immutable auditable analysis run
        ↓
deterministic presentation model
        ↓
read-only JSON API
        ↓
Venfour web application
```

The implemented backend currently covers the early product pipeline, including:

- valuation-report data contracts;
- normalized vehicle and comparable data;
- market-provider boundaries;
- MarketCheck current-market retrieval;
- MarketCheck historical candidate discovery;
- VIN-history temporal verification;
- provider-neutral comparable scoring and ranking;
- deterministic CCC-versus-external discrepancy analysis;
- immutable audit-run persistence;
- replay and integrity validation;
- deterministic presentation projection; and
- a read-only Phase 3F API exposing validated presentation JSON.

The existing backend has extensive offline tests. Existing validated Python
contracts and tests are authoritative. Before changing an existing boundary,
inspect and reuse it instead of creating a parallel implementation. Do not
casually replace or duplicate domain logic in another layer.

## Frontend direction

Venfour is planned as a responsive web product first. The current frontend
direction is:

- React;
- TypeScript;
- Vite;
- React Router;
- TanStack Query;
- Tailwind CSS; and
- carefully customized accessible UI primitives where useful.

This is direction, not evidence that the frontend has been implemented. Product
pages are intended to be designed and reviewed individually before
implementation. Do not assume the entire frontend should be generated from this
context.

The Python backend remains authoritative for analysis. A frontend should consume
structured presentation JSON and must not reproduce:

- valuation calculations;
- comparable eligibility;
- evidence selection;
- comparable scoring or ranking;
- historical verification;
- discrepancy thresholds; or
- discrepancy classifications.

## Product-development principles

Venfour is being built incrementally around stable boundaries. The broader
product direction should inform terminology, domain boundaries, reasonable
extensibility, user experience, and avoidance of architectural dead ends.

For actual engineering work, the explicit task, existing repository contracts,
and current implemented product determine what changes. Prefer:

- focused implementations;
- minimal scope;
- reuse of existing contracts;
- deterministic behavior;
- auditable evidence;
- conservative conclusions;
- strong tests;
- clean separation between analysis and presentation; and
- architecture that can reasonably accommodate Venfour's evolution.

Avoid adding unrelated capabilities merely because they fit the broader company
direction. When choosing between architectures, prefer the simplest
implementation that cleanly serves the current task without creating an obvious
obstacle to reasonable future development.
