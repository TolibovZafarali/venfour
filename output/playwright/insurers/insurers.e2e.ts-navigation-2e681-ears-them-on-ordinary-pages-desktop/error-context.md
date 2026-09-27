# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: insurers.e2e.ts >> navigation replaces insurer sources and metadata and clears them on ordinary pages
- Location: e2e/insurers.e2e.ts:96:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: 'Methodology', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e6]:
    - link "Skip to content" [ref=e7] [cursor=pointer]:
      - /url: "#main-content"
    - banner [ref=e9]:
      - generic [ref=e11]:
        - link "Venfour home" [ref=e13] [cursor=pointer]:
          - /url: /
          - generic [ref=e15]: Venfour
        - navigation "Primary navigation" [ref=e16]:
          - link "Total Loss" [ref=e17] [cursor=pointer]:
            - /url: /#total-loss
          - link "Diminished Value" [ref=e18] [cursor=pointer]:
            - /url: /#diminished-value
          - link "How It Works" [ref=e19] [cursor=pointer]:
            - /url: /#how-it-works
          - button "Sign In" [ref=e20] [cursor=pointer]
          - link "Get Started" [ref=e21] [cursor=pointer]:
            - /url: /start?service=total-loss
    - main [ref=e22]:
      - article [ref=e23]:
        - generic [ref=e24]:
          - navigation "Breadcrumb" [ref=e25]:
            - link "All states" [ref=e26] [cursor=pointer]:
              - /url: /#states
            - generic [aria-hidden] [ref=e29]: /
            - generic [ref=e30]: Missouri
          - generic [ref=e31]:
            - generic [ref=e32]:
              - generic [ref=e33]: Missouri total-loss guide
              - heading "Understand your total-loss offer in Missouri." [level=1] [ref=e34]:
                - generic [ref=e35]: Understand your
                - generic [ref=e36]: total-loss offer
                - generic [ref=e37]: in Missouri.
              - paragraph [ref=e38]: When your insurer declares your vehicle a total loss, it can be difficult to know whether the offer reflects what you lost. Start with the vehicle details, the comparisons, and the adjustments behind the number.
              - generic [ref=e39]:
                - link "Start my free valuation" [ref=e40] [cursor=pointer]:
                  - /url: /start?service=total-loss
                - paragraph [ref=e43]: Start free. No payment required for your preliminary valuation.
            - figure "MO Missouri, United States" [ref=e44]:
              - img "Outline of Missouri" [ref=e45]
              - generic [ref=e47]:
                - generic [ref=e48]: MO
                - generic [ref=e49]: Missouri, United States
          - generic [ref=e50]:
            - navigation "On this page" [ref=e51]:
              - paragraph [ref=e52]: In this guide
              - list [ref=e53]:
                - listitem [ref=e54]:
                  - link "Vehicle value" [ref=e55] [cursor=pointer]:
                    - /url: /states/missouri#missouri-value-title
                    - generic [aria-hidden] [ref=e56]: "01"
                    - text: Vehicle value
                - listitem [ref=e57]:
                  - link "Missouri rules" [ref=e58] [cursor=pointer]:
                    - /url: /states/missouri#missouri-rules-title
                    - generic [aria-hidden] [ref=e59]: "02"
                    - text: Missouri rules
                - listitem [ref=e60]:
                  - link "Review your offer" [ref=e61] [cursor=pointer]:
                    - /url: /states/missouri#missouri-offer-title
                    - generic [aria-hidden] [ref=e62]: "03"
                    - text: Review your offer
                - listitem [ref=e63]:
                  - link "How Venfour helps" [ref=e64] [cursor=pointer]:
                    - /url: /states/missouri#missouri-service-title
                    - generic [aria-hidden] [ref=e65]: "04"
                    - text: How Venfour helps
                - listitem [ref=e66]:
                  - link "Common questions" [ref=e67] [cursor=pointer]:
                    - /url: /states/missouri#missouri-faq-title
                    - generic [aria-hidden] [ref=e68]: "05"
                    - text: Common questions
              - paragraph [ref=e69]: State guidance, practical steps, and official sources to help you understand your offer.
            - generic [ref=e70]:
              - generic [ref=e71]:
                - region [ref=e72]:
                  - generic [ref=e73]:
                    - generic [aria-hidden] [ref=e74]: "01"
                    - heading "How is your vehicle’s value determined?" [level=2] [ref=e75]
                  - paragraph [ref=e76]: A total-loss valuation generally looks at your vehicle’s value immediately before the loss. Its mileage, equipment, and condition matter, along with evidence about comparable vehicles.
                  - paragraph [ref=e77]:
                    - text: Missouri’s insurance department explains that book values and dealer quotes can help establish value. When that value is disputed, similar vehicles available in the market become especially relevant.
                    - generic [ref=e78]:
                      - link "Missouri auto insurance FAQs" [ref=e79] [cursor=pointer]:
                        - /url: https://insurance.mo.gov/consumer-faqs/auto-insurance-faqs
                      - text: .
                  - paragraph [ref=e80]: The most useful starting point is your insurer’s complete valuation report. Ask for the pages showing the vehicle description, comparable vehicles, adjustments, and calculation behind the offer.
                  - heading "Four things to check in your report" [level=3] [ref=e81]
                  - table "Four things to check in your report" [ref=e82]:
                    - rowgroup [ref=e83]:
                      - row [ref=e84]:
                        - columnheader "Check" [ref=e85]
                        - columnheader "What to look for" [ref=e86]
                    - rowgroup [ref=e87]:
                      - row [ref=e88]:
                        - rowheader "Vehicle details" [ref=e89]
                        - cell "Does the report identify the correct year, model, trim, engine, drivetrain, and equipment?" [ref=e90]
                      - row [ref=e91]:
                        - rowheader "Mileage and condition" [ref=e92]
                        - cell "Is the mileage accurate? Does the condition description reflect your vehicle before the loss?" [ref=e93]
                      - row [ref=e94]:
                        - rowheader "Comparable vehicles" [ref=e95]
                        - cell "How closely do they match your vehicle? Check their equipment, mileage, location, and listing dates." [ref=e96]
                      - row [ref=e97]:
                        - rowheader "Adjustments" [ref=e98]
                        - cell "Can you follow each addition or deduction and understand why it was applied?" [ref=e99]
                  - paragraph [ref=e100]: An advertised price can provide useful market evidence. It does not establish what a vehicle ultimately sold for or guarantee the amount of an insurance settlement.
                - region [ref=e101]:
                  - generic [ref=e102]:
                    - generic [aria-hidden] [ref=e103]: "02"
                    - heading "Missouri rules worth understanding" [level=2] [ref=e104]
                  - generic [ref=e105]:
                    - heading "Depreciation deductions should have an explanation." [level=3] [ref=e106]
                    - paragraph [ref=e107]:
                      - text: Missouri’s automobile claims regulation requires reductions for betterment or depreciation to be itemized and appropriate in amount. Information supporting the reduction must be kept in the claim file.
                      - generic [ref=e108]:
                        - link "20 CSR 100-1.050(2)(E)" [ref=e109] [cursor=pointer]:
                          - /url: https://s1.sos.mo.gov/cmsimages/adrules/csr/current/20csr/20c100-1.pdf#page=4
                        - text: .
                    - paragraph [ref=e110]: If a deduction is unclear, ask your adjuster what it represents, how it was calculated, and what information supports it. Photographs, maintenance records, or documentation of your vehicle’s equipment may help clarify a disagreement.
                  - generic [ref=e111]:
                    - heading "The 80% figure needs context." [level=3] [ref=e112]
                    - paragraph [ref=e113]:
                      - text: Missouri’s salvage-vehicle definition includes a test under which the cost of specified repairs exceeds 80% of the vehicle’s pre-loss fair market value. That provision applies to vehicles damaged during a year no more than six years after their model-year designation. It also excludes certain repair costs, including hail damage and inflatable safety restraints.
                      - generic [ref=e114]:
                        - link "Missouri Revised Statutes § 301.010(55)" [ref=e115] [cursor=pointer]:
                          - /url: https://revisor.mo.gov/main/OneSection.aspx?section=301.010
                        - text: .
                    - paragraph [ref=e116]:
                      - text: The statute includes other ways a vehicle can be classified as salvage. The percentage is therefore not a universal rule for every total-loss decision, and it does not determine your settlement amount.
                      - generic [ref=e117]:
                        - link "Missouri Revised Statutes § 301.010(55)" [ref=e118] [cursor=pointer]:
                          - /url: https://revisor.mo.gov/main/OneSection.aspx?section=301.010
                        - text: .
                    - paragraph [ref=e119]: Ask your insurer to explain the basis for its decision and provide the repair estimate and vehicle valuation it used.
                  - generic [ref=e120]:
                    - heading "A replacement vehicle may qualify for a sales-tax allowance." [level=3] [ref=e121]
                    - paragraph [ref=e122]:
                      - text: Missouri’s Department of Revenue allows qualifying buyers to deduct the insurance settlement amount plus the owner’s deductible from the purchase price used to calculate tax on a replacement vehicle of the same general type.
                      - generic [ref=e123]:
                        - link "Missouri sales-tax allowance requirements" [ref=e124] [cursor=pointer]:
                          - /url: https://dor.mo.gov/faq/motor-vehicle/titling-registration.html#q13
                        - text: .
                    - paragraph [ref=e125]:
                      - text: The replacement must be purchased or contracted for after the loss and no later than 180 days after the total-loss payment. At least one owner of the totaled vehicle must also be listed on the replacement vehicle’s title application.
                      - generic [ref=e126]:
                        - link "Missouri sales-tax allowance requirements" [ref=e127] [cursor=pointer]:
                          - /url: https://dor.mo.gov/faq/motor-vehicle/titling-registration.html#q13
                        - text: .
                    - paragraph [ref=e128]:
                      - text: Ask your insurer for a total-loss statement with the vehicle details, payment date, settlement amount, and deductible. The statement must be notarized unless the insurance agent certifies that the information is true and accurate.
                      - generic [ref=e129]:
                        - link "Missouri sales-tax allowance requirements" [ref=e130] [cursor=pointer]:
                          - /url: https://dor.mo.gov/faq/motor-vehicle/titling-registration.html#q13
                        - text: .
                    - paragraph [ref=e131]:
                      - text: Check the requirements before titling your replacement vehicle. This allowance concerns the replacement purchase’s taxable price; it does not increase the underlying valuation of your totaled vehicle.
                      - generic [ref=e132]:
                        - link "Missouri sales-tax allowance requirements" [ref=e133] [cursor=pointer]:
                          - /url: https://dor.mo.gov/faq/motor-vehicle/titling-registration.html#q13
                        - text: .
                - region [ref=e134]:
                  - generic [ref=e135]:
                    - generic [aria-hidden] [ref=e136]: "03"
                    - heading "What to do if the offer seems low" [level=2] [ref=e137]
                  - paragraph [ref=e138]: Start with a specific question you can support with evidence.
                  - list [ref=e139]:
                    - listitem [ref=e140]:
                      - generic [ref=e141]:
                        - strong [ref=e142]: Get the complete report.
                        - paragraph [ref=e143]: Keep the valuation report, settlement breakdown, and correspondence together.
                    - listitem [ref=e144]:
                      - generic [ref=e145]:
                        - strong [ref=e146]: Identify the discrepancy.
                        - paragraph [ref=e147]: Point to the vehicle detail, comparison, or adjustment you want reviewed.
                    - listitem [ref=e148]:
                      - generic [ref=e149]:
                        - strong [ref=e150]: Attach relevant evidence.
                        - paragraph [ref=e151]: Include clear photographs, equipment records, or comparable listings, with dates and identifying details where available.
                    - listitem [ref=e152]:
                      - generic [ref=e153]:
                        - strong [ref=e154]: Request a written response.
                        - paragraph [ref=e155]: Ask your adjuster to explain whether the evidence changes the valuation and to provide any revised report.
                  - figure "A simple request to your adjuster" [ref=e156]:
                    - blockquote [ref=e158]:
                      - paragraph [ref=e159]: Thank you for sending the valuation report. I noticed that [specific detail] may need correction. I’ve attached [supporting document]. Could you review this and explain whether it changes the vehicle value?
                  - paragraph [ref=e160]:
                    - text: Keep a record of what you submitted and the response you received. Missouri’s insurance department also recommends documenting calls and retaining written communications.
                    - generic [ref=e161]:
                      - link "Consumer complaint guidance" [ref=e162] [cursor=pointer]:
                        - /url: https://insurance.mo.gov/consumer-complaints/insurance-complaints
                      - text: .
                - region [ref=e163]:
                  - generic [ref=e164]:
                    - generic [aria-hidden] [ref=e165]: "04"
                    - heading "How Venfour helps" [level=2] [ref=e166]
                  - paragraph [ref=e167]: Venfour helps you understand your insurer’s valuation, review available market evidence, and prepare a clearer conversation with your adjuster.
                  - generic [ref=e168]:
                    - paragraph [ref=e169]: Your starting point
                    - heading "Begin with a free preliminary valuation." [level=3] [ref=e170]
                    - paragraph [ref=e171]: Upload your insurer’s report, or start with your vehicle details if you do not have the report yet. Confirm your mileage and location, then review the preliminary findings before deciding whether to continue.
                  - generic [ref=e172]:
                    - paragraph [ref=e173]: If you choose to continue
                    - heading "Choose a full review for a one-time payment of $199." [level=3] [ref=e174]
                    - paragraph [ref=e175]:
                      - text: When the full review is available for your case,
                      - strong [ref=e176]: Get my full review
                      - text: includes examination of your insurer’s report and available vehicle comparisons, an explanation of what the evidence supports, and help preparing a message to your adjuster.
                    - paragraph [ref=e177]: A complete insurer valuation report is required for the paid review. You review the price and terms before paying.
                    - paragraph [ref=e178]: You decide what to send and remain in control of the conversation. Venfour does not negotiate directly with your insurer or act as your appointed appraiser under an appraisal clause.
                  - generic [ref=e179]:
                    - heading "Your purchase includes two refund protections." [level=3] [ref=e180]
                    - list [ref=e181]:
                      - listitem [ref=e182]:
                        - strong [ref=e183]: "If the completed review does not support a dispute:"
                        - text: your fee is refunded automatically. You keep access to your completed review and report.
                      - listitem [ref=e184]:
                        - strong [ref=e185]: "If the review supports a dispute but the final verified vehicle-value increase is under $1,000:"
                        - text: you may request a full refund after completing the Venfour-supported reconsideration process and providing the required documentation. The request must be made within 30 days after receiving the insurer’s final written response.
                    - paragraph [ref=e186]:
                      - text: The second protection measures the change in vehicle valuation, rather than the total settlement check. Eligibility conditions apply.
                      - link "Read the Fair-Result Refund Policy" [ref=e187] [cursor=pointer]:
                        - /url: /refund-policy
                      - text: .
                - region [ref=e188]:
                  - generic [ref=e189]:
                    - generic [aria-hidden] [ref=e190]: "05"
                    - heading "Common questions" [level=2] [ref=e191]
                  - generic [ref=e192]:
                    - heading "Can I start without my insurer’s valuation report?" [level=3] [ref=e193]
                    - paragraph [ref=e194]: Yes. You can begin your free preliminary valuation with your vehicle details. You will need the complete insurer report before purchasing the full review.
                  - generic [ref=e195]:
                    - heading "Can an appraisal clause help resolve a disagreement?" [level=3] [ref=e196]
                    - paragraph [ref=e197]:
                      - text: If your policy includes an appraisal clause, review it and any endorsements for the appointment requirements, costs, and effect of the outcome. Ask your insurer to identify the applicable wording before deciding whether to proceed. Missouri’s policy-reading guidance explains how to review your policy’s terms.
                      - generic [ref=e198]:
                        - link "Understanding your automobile insurance policy" [ref=e199] [cursor=pointer]:
                          - /url: https://insurance.mo.gov/understanding-your-automobile-insurance-policy
                        - text: .
                    - paragraph [ref=e200]: Venfour’s valuation review is a separate service from that formal appraisal process.
                  - generic [ref=e201]:
                    - heading "Can Missouri’s insurance department help?" [level=3] [ref=e202]
                    - paragraph [ref=e203]:
                      - text: The Missouri Department of Commerce and Insurance can investigate complaints and review an insurer’s response for compliance with applicable law and policy requirements. It cannot determine the value of your claim or the amount owed to you.
                      - generic [ref=e204]:
                        - link "Consumer complaint guidance" [ref=e205] [cursor=pointer]:
                          - /url: https://insurance.mo.gov/consumer-complaints/insurance-complaints
                        - text: .
                    - paragraph [ref=e206]:
                      - text: "Use the department’s insurance complaint process or call its consumer hotline:"
                      - link "800-726-7390" [ref=e207] [cursor=pointer]:
                        - /url: tel:8007267390
                      - text: .
                      - generic [ref=e208]:
                        - link "Consumer complaint guidance" [ref=e209] [cursor=pointer]:
                          - /url: https://insurance.mo.gov/consumer-complaints/insurance-complaints
                        - text: .
                  - generic [ref=e210]:
                    - heading "Does Venfour guarantee a higher offer?" [level=3] [ref=e211]
                    - paragraph [ref=e212]: No. The evidence may support your insurer’s valuation, a request for reconsideration, or a conclusion that the available information is insufficient. Your review explains those findings and their limitations.
              - generic [ref=e213]:
                - paragraph [ref=e214]: Your next step
                - heading "Start with a clearer understanding of your offer." [level=2] [ref=e215]
                - paragraph [ref=e216]: Bring your vehicle details and, if available, your insurer’s valuation report. See what the evidence shows before deciding whether to purchase a full review.
                - link "Start my free valuation" [ref=e217] [cursor=pointer]:
                  - /url: /start?service=total-loss
              - generic [ref=e220]:
                - paragraph [ref=e221]: General educational information. Your policy, claim circumstances, and applicable law determine your rights and coverage. For advice about a specific legal dispute, consult an attorney licensed in Missouri.
                - paragraph [ref=e222]:
                  - text: Sources checked
                  - time [ref=e223]: September 26, 2026
                  - text: .
    - contentinfo [ref=e224]:
      - generic [ref=e225]:
        - generic [ref=e226]:
          - generic [ref=e227]:
            - link "Venfour home" [ref=e228] [cursor=pointer]:
              - /url: /
              - generic [ref=e230]: Venfour
            - paragraph [ref=e231]: Your vehicle’s value,made clear.
            - paragraph [ref=e232]: Evidence to help you speak with your insurer.
            - link "support@venfour.com" [ref=e233] [cursor=pointer]:
              - /url: mailto:support@venfour.com
          - navigation "Footer navigation" [ref=e234]:
            - generic [ref=e235]:
              - heading "Services" [level=2] [ref=e236]
              - list [ref=e237]:
                - listitem [ref=e238]:
                  - link "Total Loss" [ref=e239] [cursor=pointer]:
                    - /url: /#total-loss
                - listitem [ref=e240]:
                  - link "Diminished Value" [ref=e241] [cursor=pointer]:
                    - /url: /#diminished-value
                  - generic [ref=e242]: New requests paused
            - generic [ref=e243]:
              - heading "Resources" [level=2] [ref=e244]
              - list [ref=e245]:
                - listitem [ref=e246]:
                  - link "Understanding your report" [ref=e247] [cursor=pointer]:
                    - /url: /resources/understanding-your-report
                - listitem [ref=e248]:
                  - link "Valuation checklist" [ref=e249] [cursor=pointer]:
                    - /url: /resources/valuation-review-checklist
                - listitem [ref=e250]:
                  - link "How we review reports" [ref=e251] [cursor=pointer]:
                    - /url: /methodology
            - generic [ref=e252]:
              - heading "Company" [level=2] [ref=e253]
              - list [ref=e254]:
                - listitem [ref=e255]:
                  - link "About Venfour" [ref=e256] [cursor=pointer]:
                    - /url: /about
                - listitem [ref=e257]:
                  - link "Contact" [ref=e258] [cursor=pointer]:
                    - /url: /contact
                - listitem [ref=e259]:
                  - link "Referral partners" [ref=e260] [cursor=pointer]:
                    - /url: /referral-partners
            - navigation "Footer states" [ref=e261]:
              - heading "States" [level=2] [ref=e262]
              - list [ref=e263]:
                - listitem [ref=e264]:
                  - link "California" [ref=e265] [cursor=pointer]:
                    - /url: /states/california
                - listitem [ref=e266]:
                  - link "Florida" [ref=e267] [cursor=pointer]:
                    - /url: /states/florida
                - listitem [ref=e268]:
                  - link "Georgia" [ref=e269] [cursor=pointer]:
                    - /url: /states/georgia
                - listitem [ref=e270]:
                  - link "Illinois" [ref=e271] [cursor=pointer]:
                    - /url: /states/illinois
                - listitem [ref=e272]:
                  - link "Missouri" [active] [ref=e273] [cursor=pointer]:
                    - /url: /states/missouri
                - listitem [ref=e274]:
                  - link "New York" [ref=e275] [cursor=pointer]:
                    - /url: /states/new-york
                - listitem [ref=e276]:
                  - link "North Carolina" [ref=e277] [cursor=pointer]:
                    - /url: /states/north-carolina
                - listitem [ref=e278]:
                  - link "Ohio" [ref=e279] [cursor=pointer]:
                    - /url: /states/ohio
                - listitem [ref=e280]:
                  - link "Pennsylvania" [ref=e281] [cursor=pointer]:
                    - /url: /states/pennsylvania
                - listitem [ref=e282]:
                  - link "Texas" [ref=e283] [cursor=pointer]:
                    - /url: /states/texas
              - link "All states" [ref=e284] [cursor=pointer]:
                - /url: /#states
                - text: All states
                - generic [aria-hidden] [ref=e285]: →
            - navigation "Footer insurance companies" [ref=e286]:
              - heading "Insurance companies" [level=2] [ref=e287]
              - list [ref=e288]:
                - listitem [ref=e289]:
                  - link "Allstate" [ref=e290] [cursor=pointer]:
                    - /url: /insurers/allstate
                - listitem [ref=e291]:
                  - link "Farmers" [ref=e292] [cursor=pointer]:
                    - /url: /insurers/farmers
                - listitem [ref=e293]:
                  - link "GEICO" [ref=e294] [cursor=pointer]:
                    - /url: /insurers/geico
                - listitem [ref=e295]:
                  - link "Liberty Mutual" [ref=e296] [cursor=pointer]:
                    - /url: /insurers/liberty-mutual
                - listitem [ref=e297]:
                  - link "Nationwide" [ref=e298] [cursor=pointer]:
                    - /url: /insurers/nationwide
                - listitem [ref=e299]:
                  - link "Progressive" [ref=e300] [cursor=pointer]:
                    - /url: /insurers/progressive
                - listitem [ref=e301]:
                  - link "State Farm" [ref=e302] [cursor=pointer]:
                    - /url: /insurers/state-farm
                - listitem [ref=e303]:
                  - link "USAA" [ref=e304] [cursor=pointer]:
                    - /url: /insurers/usaa
              - link "All insurer guides" [ref=e305] [cursor=pointer]:
                - /url: /insurers
                - text: All insurer guides
                - generic [aria-hidden] [ref=e306]: →
        - generic [ref=e307]:
          - paragraph [ref=e308]: © 2026 Venfour LLC. All rights reserved.
          - navigation "Footer legal navigation" [ref=e309]:
            - list [ref=e310]:
              - listitem [ref=e311]:
                - link "Terms" [ref=e312] [cursor=pointer]:
                  - /url: /terms
              - listitem [ref=e313]:
                - link "Privacy" [ref=e314] [cursor=pointer]:
                  - /url: /privacy
              - listitem [ref=e315]:
                - link "Refund policy" [ref=e316] [cursor=pointer]:
                  - /url: /refund-policy
              - listitem [ref=e317]:
                - link "Cookie Policy" [ref=e318] [cursor=pointer]:
                  - /url: /cookies
              - listitem [ref=e319]:
                - button "Cookie preferences" [ref=e320] [cursor=pointer]
  - complementary "Preview notice" [ref=e321]:
    - generic [ref=e322]: Local preview · Fictional data
    - link "All screens" [ref=e323] [cursor=pointer]:
      - /url: /_local/workspace
```

# Test source

```ts
  10  | 
  11  | test("directory and footer expose all eight guides without overflow", async ({ page }, testInfo) => {
  12  |   await page.goto("/insurers");
  13  |   await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  14  |   await expect(page).toHaveTitle(insurerDirectoryMetadata.title);
  15  |   await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", insurerDirectoryMetadata.canonical);
  16  |   const main = page.getByRole("main");
  17  |   const paths = await main.locator('a[href^="/insurers/"]').evaluateAll(links => links.map(link => link.getAttribute("href")));
  18  |   expect(paths).toEqual([...insurers].sort((a, b) => a.name.localeCompare(b.name)).map(insurerPath));
  19  |   await expect(main.getByRole("searchbox")).toHaveCount(0);
  20  |   await expect(main.getByRole("combobox")).toHaveCount(0);
  21  |   const footer = page.getByRole("navigation", { name: "Footer insurance companies" });
  22  |   await expect(footer.getByRole("link")).toHaveCount(9);
  23  |   const expectedColumns = page.viewportSize()!.width >= 1280 ? 5 : page.viewportSize()!.width >= 640 ? 3 : 2;
  24  |   expect(await page.getByRole("navigation", { name: "Footer navigation", exact: true }).evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(expectedColumns);
  25  |   for (const insurer of insurers) {
  26  |     const link = footer.getByRole("link", { name: insurer.name, exact: true });
  27  |     await expect(link).toHaveAttribute("href", insurerPath(insurer));
  28  |     expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  29  |   }
  30  |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  31  |   await page.screenshot({ path: testInfo.outputPath("insurer-directory.png"), fullPage: true });
  32  |   const allstate = footer.getByRole("link", { name: "Allstate", exact: true });
  33  |   await allstate.focus();
  34  |   await expect(allstate).toBeFocused();
  35  |   await page.keyboard.press("Enter");
  36  |   await expect(page.getByRole("heading", { level: 1 })).toHaveText("Understand your Allstate total-loss offer.");
  37  |   await expect(page).toHaveURL(/\/insurers\/allstate$/);
  38  |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  39  | });
  40  | 
  41  | test("Liberty Mutual guide supports readable tables, keyboard sections, and the existing intake", async ({ page }, testInfo) => {
  42  |   await page.goto("/insurers/liberty-mutual");
  43  |   const article = page.getByRole("article");
  44  |   await expect(article.getByRole("heading", { level: 1 })).toHaveText("Understand your Liberty Mutual total-loss offer.");
  45  |   await expect(article.locator("details:not([open])")).toHaveCount(0);
  46  |   const table = article.getByRole("table");
  47  |   await expect(table.getByRole("row")).toHaveCount(5);
  48  |   expect(await table.locator("th, td").evaluateAll(cells => cells.every(cell => cell.scrollWidth <= cell.clientWidth))).toBe(true);
  49  |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  50  |   const contents = article.getByRole("navigation", { name: "On this page" });
  51  |   await expect(contents.getByRole("link")).toHaveCount(5);
  52  |   await contents.getByRole("link", { name: "Common questions", exact: true }).focus();
  53  |   await page.keyboard.press("Enter");
  54  |   await expect(article.locator("#liberty-mutual-faq-title")).toBeFocused();
  55  |   await expect(article.locator("#liberty-mutual-faq-title")).toBeInViewport();
  56  |   await page.evaluate(() => window.scrollTo(0, 0));
  57  |   await page.screenshot({ path: testInfo.outputPath("liberty-mutual-hero.png") });
  58  |   await page.screenshot({ path: testInfo.outputPath("liberty-mutual-guide.png"), fullPage: true });
  59  |   const actions = article.getByRole("link", { name: "Start my free valuation" });
  60  |   await expect(actions).toHaveCount(2);
  61  |   for (const action of await actions.all()) await expect(action).toHaveAttribute("href", "/start?service=total-loss");
  62  |   await article.getByRole("link", { name: "All insurer guides", exact: true }).focus();
  63  |   await page.keyboard.press("Tab");
  64  |   await expect(actions.first()).toBeFocused();
  65  |   await page.keyboard.press("Enter");
  66  |   await expect(page).toHaveURL(/\/start\?service=total-loss$/);
  67  |   await expect(page.getByRole("heading", { name: "Start with a free valuation." })).toBeVisible();
  68  | });
  69  | 
  70  | test("deep section links focus the selected heading on first load", async ({ page }) => {
  71  |   await page.goto("/insurers/state-farm#state-farm-review-title");
  72  |   const heading = page.locator("#state-farm-review-title");
  73  |   await expect(heading).toBeFocused();
  74  |   await expect(heading).toBeInViewport();
  75  | });
  76  | 
  77  | for (const insurer of insurers) {
  78  |   test(`${insurer.name} guide renders with its own metadata and sources`, async ({ page }, testInfo) => {
  79  |     test.skip(!["small-phone", "desktop"].includes(testInfo.project.name), "The representative guide covers the full viewport matrix.");
  80  |     await page.goto(insurerPath(insurer));
  81  |     const article = page.getByRole("article");
  82  |     await expect(article.getByRole("heading", { level: 1 })).toHaveText(`Understand your ${insurer.name} total-loss offer.`);
  83  |     await expect(page).toHaveTitle(insurerMetadata(insurer).title);
  84  |     await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", insurerMetadata(insurer).description);
  85  |     await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", insurerMetadata(insurer).canonical);
  86  |     await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", insurerMetadata(insurer).canonical);
  87  |     await expect(article.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}/);
  88  |     expect(await article.locator('a[href^="https://"]').count()).toBeGreaterThan(0);
  89  |     await expect(article.getByRole("link", { name: "Start my free valuation" })).toHaveCount(2);
  90  |     expect(await article.getByRole("table").locator("th, td").evaluateAll(cells => cells.every(cell => cell.scrollWidth <= cell.clientWidth))).toBe(true);
  91  |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  92  |     await page.screenshot({ path: testInfo.outputPath(`${insurer.slug}-guide.png`), fullPage: true });
  93  |   });
  94  | }
  95  | 
  96  | test("navigation replaces insurer sources and metadata and clears them on ordinary pages", async ({ page }, testInfo) => {
  97  |   test.skip(testInfo.project.name !== "desktop", "Metadata behavior is independent of viewport.");
  98  |   await page.goto("/insurers/geico?source=example");
  99  |   await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toContainText("GEICO");
  100 |   await page.getByRole("navigation", { name: "Footer insurance companies" }).getByRole("link", { name: "State Farm", exact: true }).click();
  101 |   await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toContainText("State Farm");
  102 |   await expect(page.locator("#geico-documents-title")).toHaveCount(0);
  103 |   await expect(page.getByRole("article").locator('a[href*="geico.com"]')).toHaveCount(0);
  104 |   await expect(page).toHaveTitle(insurerMetadata(insurers.find(insurer => insurer.slug === "state-farm")!).title);
  105 |   await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  106 |   await page.getByRole("navigation", { name: "Footer states" }).getByRole("link", { name: "Missouri", exact: true }).click();
  107 |   await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toContainText("Missouri");
  108 |   await expect(page.locator("#state-farm-documents-title")).toHaveCount(0);
  109 |   await expect(page).toHaveTitle(stateMetadata(states.find(state => state.code === "MO")!).title);
> 110 |   await page.getByRole("link", { name: "Methodology", exact: true }).click();
      |                                                                      ^ Error: locator.click: Test timeout of 30000ms exceeded.
  111 |   await expect(page).toHaveTitle("Total-Loss Review Methodology | Venfour");
  112 |   await expect(page.locator("[data-page-metadata]")).toHaveCount(0);
  113 | });
  114 | 
  115 | test("homepage and directory do not download unvisited insurer guides", async ({ page }, testInfo) => {
  116 |   test.skip(testInfo.project.name !== "desktop", "Content loading is independent of viewport.");
  117 |   const requestedGuides = new Set<string>();
  118 |   page.on("request", request => {
  119 |     const match = new URL(request.url()).pathname.match(/\/features\/insurers\/guides\/([^/]+)\.ts$/);
  120 |     if (match) requestedGuides.add(match[1]);
  121 |   });
  122 |   await page.goto("/");
  123 |   await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  124 |   expect([...requestedGuides]).toEqual([]);
  125 |   await page.getByRole("navigation", { name: "Footer insurance companies" }).getByRole("link", { name: /All insurer guides/ }).click();
  126 |   await expect(page).toHaveURL(/\/insurers$/);
  127 |   expect([...requestedGuides]).toEqual([]);
  128 |   await page.getByRole("main").locator('a[href="/insurers/geico"]').click();
  129 |   await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toContainText("GEICO");
  130 |   expect([...requestedGuides]).toEqual(["geico"]);
  131 |   await page.getByRole("navigation", { name: "Footer insurance companies" }).getByRole("link", { name: "State Farm", exact: true }).click();
  132 |   await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toContainText("State Farm");
  133 |   expect([...requestedGuides].sort()).toEqual(["geico", "state-farm"]);
  134 | });
  135 | 
  136 | test("failed guide downloads recover through the existing retry button", async ({ page }, testInfo) => {
  137 |   test.skip(testInfo.project.name !== "desktop", "Download recovery is independent of viewport.");
  138 |   let failDownload = true;
  139 |   await page.route("**/features/insurers/guides/state-farm.ts*", route => failDownload ? route.abort() : route.continue());
  140 |   await page.goto("/insurers/state-farm");
  141 |   await expect(page.getByRole("alert")).toContainText("We couldn’t display this page.");
  142 |   await expect(page.getByRole("article")).toHaveCount(0);
  143 |   failDownload = false;
  144 |   await page.getByRole("button", { name: "Try again" }).click();
  145 |   await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toHaveText("Understand your State Farm total-loss offer.");
  146 | });
  147 | 
  148 | test("unknown, uppercase, and nested insurer paths show the not-found page", async ({ page }, testInfo) => {
  149 |   test.skip(testInfo.project.name !== "desktop", "Route rejection is independent of viewport.");
  150 |   for (const path of ["/insurers/not-an-insurer", "/insurers/GEICO", "/insurers/state-farm/extra"]) {
  151 |     await page.goto(path);
  152 |     await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  153 |     await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  154 |   }
  155 | });
  156 | 
```