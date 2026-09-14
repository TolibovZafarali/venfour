import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { FormData as NativeFormData } from "undici";
import { createClient } from "@supabase/supabase-js";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, passthrough } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseAuthService } from "@/features/auth/auth-service";
import { createTotalLossDependencies } from "@/features/total-loss/dependencies-context";
import { createCustomerProfileService } from "@/features/customer-profile/service";
import { readTotalLossDraft } from "@/features/total-loss/draft";
import type { Database } from "@/lib/supabase/database.types";
import type * as EnvironmentModule from "@/config/env";
import * as fullReviewApi from "@/features/full-review/api";
import { renderTestApp } from "@/test/render";
import { server } from "@/test/mocks/server";

vi.mock("@/config/env", async (original) => {
  const actual = await original<typeof EnvironmentModule>();
  return { ...actual, environment: { ...actual.environment, apiBaseUrl: "http://127.0.0.1:8000", supabaseUrl: "", supabasePublishableKey: "" } };
});
vi.mock("@/config/product-availability", () => ({ totalLossManualIntakeAvailable: true }));
vi.mock("@/features/analyses/components/valuation-signal-field", () => ({
  ValuationSignalField: () => <canvas aria-hidden="true" />,
}));

const enabled = process.env.VENFOUR_LOCAL_INTAKE_TEST === "1";
const origin = "http://127.0.0.1:54321";
const backend = "http://127.0.0.1:8000";
const vin = "KMHLM4AG0RU900001";
const decodedFacts = { bodyType: "Sedan", drivetrain: "FWD", engine: "2.0L I4", fuelType: "Unleaded", transmission: "Automatic", cylinders: "4" };
const intake = () => within(document.querySelector<HTMLElement>("[data-appraisal-start-flow]")!);

// Opt-in only: uses the isolated local database and guarded fixture backend.
describe.skipIf(!enabled)("normal free intake against local database and fixture transport", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("preserves the selected PDF bytes at the local multipart bridge", async () => {
    vi.stubGlobal("File", NativeFile);
    vi.stubGlobal("Blob", NativeBlob);
    const bytes = readFileSync(path.resolve("../output/local-market/full-review.pdf"));
    const selected = new NativeFile([bytes], "fixture.pdf", { type: "application/pdf" });
    const form = new NativeFormData();
    form.append("report", selected, "fixture.pdf");
    const stored = form.get("report") as File;
    const actual = Buffer.from(await stored.arrayBuffer());
    expect(actual.equals(bytes)).toBe(true);
  });
  it.each(["manual", "VIN"])("saves, submits, claims and reopens one %s intake without technical edits", async (method) => {
    const raw = execFileSync(path.resolve("node_modules/.bin/supabase"), ["status", "--output", "json"],
      { cwd: path.resolve(".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const status = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, string>;
    expect(status.API_URL).toBe(origin);
    const client = createClient<Database>(origin, status.PUBLISHABLE_KEY ?? status.ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `intake-${method}-${crypto.randomUUID()}` } });
    const admin = createClient<Database>(origin, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `intake-admin-${method}-${crypto.randomUUID()}` } });
    const uploadReport = fullReviewApi.uploadFullReview;
    let completedUploads = 0;
    vi.spyOn(fullReviewApi, "uploadFullReview").mockImplementation(async (...args) => {
      try { const result = await uploadReport(...args); completedUploads += 1; return result; }
      catch (error) { console.info({ uploadFailure: error instanceof Error ? error.message : String(error) }); throw error; }
    });
    const dependencies = createTotalLossDependencies(client);
    const auth = createSupabaseAuthService(client);
    let submissions = 0;
    let savedInput: { id: string | null | undefined; revision: number | null | undefined } | undefined;
    server.use(
      http.all(`${origin}/*`, () => passthrough()),
      http.all(`${backend}/*`, () => passthrough()),
      http.get("https://vpic.nhtsa.dot.gov/api/vehicles/*", ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname.includes("DecodeVinValues")) return HttpResponse.json({ Results: [{
          VIN: vin, ErrorCode: "0", ModelYear: "2024", Make: "Hyundai", Model: "Elantra", Trim: "SEL",
          BodyClass: "Sedan/Saloon", DriveType: "fwd / front wheel drive", EngineCylinders: "4",
          DisplacementL: "2", EngineConfiguration: "In-Line", FuelTypePrimary: "Gasoline", TransmissionStyle: "automatic",
        }] });
        if (url.pathname.includes("GetMakesForVehicleType")) return HttpResponse.json({ Results: [{ MakeName: "Hyundai" }] });
        if (url.pathname.includes("GetModelsForMakeYear")) return HttpResponse.json({ Results: [{ Model_Name: "Elantra" }] });
        throw new Error("Unexpected vehicle catalog request.");
      }),
    );
    server.use(http.post(`${backend}/api/v1/appraisal-cases/:caseId/analysis`, async ({ request, params }) => {
      submissions += 1;
      const body = await request.clone().json();
      const session = (await client.auth.getSession()).data.session!;
      const details = await dependencies.totalLossDetailsService.getDetails({ caseId: String(params.caseId), userId: session.user.id });
      expect(details?.intakeCompletedAt).toBeTruthy();
      expect(body).toEqual({ expectedAnalysisInputId: details?.analysisInputId, expectedAnalysisInputRevision: details?.analysisInputRevision });
      savedInput = { id: details?.analysisInputId, revision: details?.analysisInputRevision };
      expect(details?.insurerVehicleValuation).toBeNull();
      expect(details?.insurerName).toBeNull();
      expect(details?.vehicleFacts ?? null).toEqual(method === "VIN" ? decodedFacts : null);
      return passthrough();
    }));
    const before = await (await fetch(`${backend}/api/local/market-fixtures/status`)).json();
    expect(before.liveMarketCheckRequests).toBe(0);
    const options = {
      authService: auth,
      authTurnstileController: { async runWithToken<T>(_action: unknown, operation: (token: string) => Promise<T>) { return operation("local-fixture-challenge"); } },
      totalLossDependencies: dependencies,
      appraisalCaseService: dependencies.appraisalCaseService,
      customerProfileService: createCustomerProfileService(client),
      strictMode: true,
    };
    const user = userEvent.setup();
    let view = renderTestApp(["/start?service=total-loss"], options);
    await user.click(await screen.findByRole("radio", { name: /I don’t have the report/i }));
    await user.click(intake().getByRole("button", { name: "Continue", exact: true }));
    await screen.findByRole("heading", { name: "Tell us about your vehicle" });
    if (method === "VIN") {
      await user.type(screen.getByLabelText("VIN"), vin);
      await user.click(screen.getByRole("button", { name: "Find vehicle" }));
      await screen.findByRole("region", { name: "Confirmed vehicle details" });
    } else {
      await user.click(screen.getByRole("radio", { name: "Select vehicle details" }));
      await waitFor(() => expect(screen.getByLabelText("Make")).toBeEnabled());
      await user.selectOptions(screen.getByLabelText("Year"), "2024");
      await user.selectOptions(screen.getByLabelText("Make"), "Hyundai");
      await waitFor(() => expect(screen.getByLabelText("Model")).toBeEnabled());
      await user.selectOptions(screen.getByLabelText("Model"), "Elantra");
      await waitFor(() => expect(screen.getByLabelText("Trim")).toBeEnabled());
      await user.selectOptions(screen.getByLabelText("Trim"), "SEL");
    }
    for (const label of ["Engine", "Transmission", "Drive type", "Body style", "Number of cylinders"]) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm vehicle & continue" }));
    await user.type(await screen.findByLabelText("Mileage at time of loss"), "50000");
    await user.type(screen.getByLabelText("ZIP code"), "63026");
    await user.click(screen.getByLabelText("Date of loss"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Calendar year" }), "2026");
    await user.selectOptions(screen.getByRole("combobox", { name: "Calendar month" }), "7");
    await user.click(screen.getByRole("gridcell", { name: /Aug(?:ust)? 11, 2026/i }));
    await user.click(intake().getByRole("button", { name: "Continue", exact: true }));
    await screen.findByRole("heading", { name: "Contact details" });
    const draft = readTotalLossDraft();
    expect(draft.ok && draft.draft?.confirmedCaseId).toBeTruthy();
    if (!draft.ok || !draft.draft?.confirmedCaseId) throw new Error("Normal intake did not persist its case.");
    const caseId = draft.draft.confirmedCaseId;
    const guestId = (await client.auth.getSession()).data.session!.user.id;
    await waitFor(async () => {
      const details = await dependencies.totalLossDetailsService.getDetails({ caseId, userId: guestId });
      expect(details?.mileageAtLoss).toBe(50000);
      expect(details?.vehicleFacts ?? null).toEqual(method === "VIN" ? decodedFacts : null);
    });
    view.unmount();
    view = renderTestApp([`/start?service=total-loss&caseId=${caseId}`], options);
    await screen.findByRole("heading", { name: "Contact details" });
    const email = `free-intake-${method.toLowerCase()}-${crypto.randomUUID()}@example.test`;
    await user.type(screen.getByLabelText("First name"), "Fixture");
    await user.type(screen.getByLabelText("Last name"), "Driver");
    await user.type(screen.getByLabelText("Email address"), email);
    await user.click(screen.getByRole("checkbox", { name: /Terms of Use/i }));
    await user.click(screen.getByRole("checkbox", { name: /Privacy Policy/i }));
    const submit = screen.getByRole("button", { name: "Review & analyze" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(submissions).toBe(1), { timeout: 15000 });
    await waitFor(() => expect(view.router.state.location.pathname).toBe(`/total-loss/cases/${caseId}/analysis`), { timeout: 15000 });
    await waitFor(async () => {
      const token = (await client.auth.getSession()).data.session!.access_token;
      const response = await fetch(`${backend}/api/v1/appraisal-cases/${caseId}/analysis`, { headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      expect(result.status).toBe("completed");
      expect(result.analysisInputId).toBe(savedInput?.id);
    }, { timeout: 45000 });
    const submittedDraft = readTotalLossDraft();
    if (!submittedDraft.ok || !submittedDraft.draft?.identityClaimId) throw new Error("Normal intake did not provide a guest claim.");
    const claimId = submittedDraft.draft.identityClaimId;
    view.unmount();
    const generated = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (generated.error) throw generated.error;
    const verified = await client.auth.verifyOtp({ type: "magiclink", token_hash: generated.data.properties.hashed_token });
    if (verified.error) throw verified.error;
    const claimed = await dependencies.totalLossIdentityService!.completeIdentityClaim(claimId);
    expect(claimed?.caseId).toBe(caseId);
    const ownerId = verified.data.user!.id;
    const owned = await dependencies.totalLossDetailsService.getDetails({ caseId, userId: ownerId });
    expect(owned?.analysisInputId).toBe(savedInput?.id);
    expect(owned?.vehicleFacts ?? null).toEqual(method === "VIN" ? decodedFacts : null);
    const afterRun = await (await fetch(`${backend}/api/local/market-fixtures/status`)).json();
    view = renderTestApp([`/total-loss/cases/${caseId}/analysis`], options);
    await screen.findByRole("link", { name: /Upload.*insurer.*report/i }, { timeout: 30000 });
    view.unmount();
    view = renderTestApp([`/total-loss/cases/${caseId}/analysis`], options);
    await screen.findByRole("link", { name: /Upload.*insurer.*report/i }, { timeout: 30000 });
    const afterReopen = await (await fetch(`${backend}/api/local/market-fixtures/status`)).json();
    expect(afterReopen.fixtureAttempts).toBe(afterRun.fixtureAttempts);
    expect(afterReopen.liveMarketCheckRequests).toBe(0);
    expect(afterReopen.blockedExternalAttempts).toBe(before.blockedExternalAttempts);
    expect(afterReopen.blockedNativeTransportAttempts).toBe(before.blockedNativeTransportAttempts);
    expect(afterReopen.documentExtractions).toBe(before.documentExtractions);
    expect(submissions).toBe(1);
    console.info(JSON.stringify({ phase: "free_result_reopened", method, caseId, input: savedInput,
      fixtureAttempts: afterRun.fixtureAttempts - before.fixtureAttempts, submissions, factsPreserved: true,
      claimed: true, reopenExtraAttempts: 0, liveMarketCheckRequests: 0 }));
    await user.click(screen.getByRole("link", { name: /Upload.*insurer.*report/i }));
    await screen.findByRole("heading", { name: "Add your insurer’s valuation report" });
    expect(screen.queryByRole("button", { name: "Continue to secure checkout" })).not.toBeInTheDocument();
    const pdfBytes = readFileSync(path.resolve("../output/local-market/full-review.pdf"));
    vi.stubGlobal("FormData", NativeFormData);
    vi.stubGlobal("File", NativeFile);
    vi.stubGlobal("Blob", NativeBlob);
    const pdf = new NativeFile([pdfBytes], "fictional-insurer-report.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Choose the complete valuation PDF"), { target: { files: [pdf] } });
    await waitFor(() => expect(completedUploads).toBe(1), { timeout: 30000 });
    await waitFor(() => expect(screen.queryByLabelText("Checking report")).not.toBeInTheDocument(), { timeout: 20000 });
    const token = (await client.auth.getSession()).data.session!.access_token;
    let fullReview = await (await fetch(`${backend}/api/v1/appraisal-cases/${caseId}/full-review`, { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(["needs_confirmation", "ready"]).toContain(fullReview.status);
    while (fullReview.status === "needs_confirmation") {
      expect(fullReview.issues[0].code).toBe("REPORT_FACT_CONFLICT");
      await user.click(screen.getByRole("radio", { name: /In the report/i }));
      await user.click(screen.getByRole("button", { name: "Confirm and continue" }));
      await waitFor(() => expect(screen.queryByLabelText("Checking report")).not.toBeInTheDocument(), { timeout: 10000 });
      fullReview = await (await fetch(`${backend}/api/v1/appraisal-cases/${caseId}/full-review`, { headers: { Authorization: `Bearer ${token}` } })).json();
    }
    expect(fullReview.ready).toBe(true);
    expect(await screen.findByText(/Payment is not available right now/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continue to secure checkout" })).not.toBeInTheDocument();
    const afterReport = await (await fetch(`${backend}/api/local/market-fixtures/status`)).json();
    expect(afterReport.fixtureAttempts).toBe(afterRun.fixtureAttempts);
    const stillSaved = await dependencies.totalLossDetailsService.getDetails({ caseId, userId: ownerId });
    expect(stillSaved?.analysisInputId).toBe(savedInput?.id);
    console.info(JSON.stringify({ scenario: method, caseId, input: savedInput, submissions,
      fixtureAttempts: afterRun.fixtureAttempts - before.fixtureAttempts, liveMarketCheckRequests: 0,
      claimed: true, factsPreserved: true, reopenExtraAttempts: 0, reportStorageAndExtraction: true,
      checkoutHiddenBeforeReadiness: true, paymentUnavailableAfterReadiness: true, fullReviewReady: fullReview.ready }));
    cleanup();
    await client.auth.signOut({ scope: "local" });
  }, 90000);
});
