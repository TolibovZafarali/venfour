# Public and workspace visual systems

Venfour shares its logo, font families, voice, and interaction quality across two
presentations:

- `venfour.com`: public marketing and acquisition, with the existing colors,
  gradients, glass header, and editorial layouts.
- `app.venfour.com`: a professional appraisal and claims workspace, with dark
  typography, pure white backgrounds, neutral surfaces and borders, and a
  restrained blue accent for primary actions and selected states.

## Document boundary

`frontend/src/app/visual-system.ts` selects the presentation. The production host
is authoritative, including unknown routes. Local and staging builds use the
existing route audience map: known public routes are public; all other routes
default to the workspace system. A public-only build remains public locally.

`main.tsx` sets `data-visual-system` on the document before rendering.
`VisualSystemProvider` updates it on router navigation and also covers loading
and error routes. Because the attribute is on `html`, menus, dialogs, and other
portals mounted under `body` inherit the same tokens.

This boundary changes presentation only. Existing routes, authentication,
permissions, case state, payment execution, and analysis contracts remain the
workflow authorities.

## Styles and shared components

| File or component | Responsibility |
| --- | --- |
| `styles/brand-foundations.css` | Shared font families and functional brand accent |
| `styles/public-tokens.css` | Existing public palette and geometry |
| `styles/public-surfaces.css` | Public-only gradients, intake legacy backgrounds, and glass chrome; every selector excludes app documents |
| `styles/app-tokens.css` | Explicit white/black/grayscale palette, compact radii, restrained shadows, and functional accent tokens |
| `styles/app-components.css` | App header, intake surfaces, shared floating panels, buttons, and visible keyboard focus |
| `AppShell` | Fixed white app header and existing compact workspace chrome; public navigation, detached glass header, and marketing footer remain public |
| Auth, cookie preferences, and intake popovers | Shared markup with `data-product-overlay`; only app documents receive the crisp white panel treatment |
| Button hover controller | Decorative fluid hover remains available only in the public presentation |
| `components/customer-workspace.css` | White customer workspace and full-width case steps directly below the header progress line |
| Workflow, admin, and partner CSS | White page backgrounds and neutral component colors, with restrained geometry |
| Embedded payment appearance | Neutral payment fields with the resolved document primary color for selection and focus inside the provider iframe |

## Rules for future app pages

Use semantic tokens such as `bg-background`, `text-ink`, `text-copy`, `border-line`,
and `bg-surface`. Page backgrounds use `--background` or `--canvas`, both pure
white. Secondary surfaces may use `--surface` (`#f5f5f5`). Every neutral color has
equal red, green, and blue channels. Keep page backgrounds, cards, controls, and
overlays free of gradients, glass effects, decorative illustrations, and large
colored surfaces.

The app defines its accent in `app-tokens.css`; public brand tokens stay separate.

| Token | App value | Use |
| --- | --- | --- |
| `--brand`, `--primary` | `#2563EB` | Main action, progress fill, small evidence or status emphasis |
| `--brand-strong`, `--link-hover` | `#1D4ED8` | Hover and pressed primary actions and important links |
| `--link`, `--ring`, `--selection` | Primary accent | Important links, visible keyboard focus, selected controls |
| `--selection-surface` | 5% primary accent on white | Selected radio choices and the current appraisal in a menu |
| `--brand-soft`, `--accent`, `--surface` | Neutral gray | General supporting surfaces and secondary controls |

Use the shared Button for primary actions. Its app hover and pressed treatment
also covers existing intake, review, request, and authentication actions. Keep
secondary actions neutral and disabled primary actions gray. Preserve dark
headings, body text, prices, and large conclusions; use blue only where it
clarifies an action, state, or small data mark.
Do not turn every label, icon, link, or border blue. The selected control tint is
an exception for small interactive surfaces, not a general card background.

Small warning/error/success indicators may retain a semantic color when their
text or icon communicates the same meaning. Their surrounding surfaces remain
neutral. Never make color the only status signal.

Keep shared public styles scoped to the public presentation. Put app-specific
markup styling in its owning feature stylesheet; do not duplicate workflow logic
to create a visual variant. Floating panels must inherit the document system.
Preserve visible focus, target sizes, responsive layouts, and reduced motion.

Customer report images, uploaded evidence, and email/PDF previews display the
original content. They are documents inside the workspace, not app chrome; do not
recolor their contents.

## Verification

The visual-boundary tests cover production hosts, future app routes, combined
builds, navigation, portals, errors, and decorative hover isolation. The palette
contract test checks white primary backgrounds, the two allowed accent values,
equal-channel grayscale neutral tokens,
public-only background selectors, and rejects gradients or tinted literal
background colors in app feature stylesheets.

Review representative public and app routes in a browser at desktop and mobile
sizes whenever either shared tokens or the shell changes. Check computed colors,
keyboard focus, overflow, and reduced motion. Synthetic local previews verify
presentation without starting real provider, customer, or payment operations.

## Initial split review, September 15, 2026

- Compared public Home, Contact, and Terms at 1440px and 390px against captures
  taken before implementation. Layout, typography, and visual treatments were
  retained. Four captures matched exactly; desktop Contact and Terms had a
  maximum four-level RGB rendering difference without a layout or text difference.
- Reviewed new and saved intake, free results, processing, checkout, completed
  review, waiting state, admin overview/cases/payments/partners, partner dashboard
  and onboarding, account appraisal switching, and privacy preferences. App page
  backgrounds were pure white, with no gradients, warm/tinted surfaces, horizontal
  overflow, or page errors in the final route captures.
- Verified visible keyboard focus, checkbox/switch Space interaction, file-upload
  focus, and reduced motion at desktop and mobile sizes. Programmatically focused
  result regions retain focus without a decorative outline around the whole page.
- Verified production hostname selection using browser requests mapped to local
  assets; this is local presentation evidence, not a deployment check.
- Full frontend suite: 2,086 passed and three skipped, using four workers. An
  unrestricted parallel run hit two guest-link lookup timeouts; both passed in
  isolation and in the final four-worker run. Typecheck, build, changed-file lint,
  and whitespace validation passed. The build retains its large-bundle warning.
- Checkout fields use the updated provider appearance configuration; browser
  review used simulated payment fields. No live payment was exercised.

Screenshots and browser observations are saved in `output/visual-system/`.
The standalone dashboard preview now initializes the same document presentation
as the application, because it does not use `AppProvider`.

## Customer workspace refinement

The customer workspace uses the shared white background, neutral component
palette, and controlled blue accent within the public/app boundary. Case steps
now appear immediately below the header progress line without a bottom divider.
The vehicle name is centered between the Venfour logo and account controls in the
header, without a secondary review label.
Desktop labels use the full width of the line and the same ordered section model;
mobile uses the existing accessible section selector in that position. Section
availability, current-stage calculation, navigation, and workflow state remain
unchanged.

The customer workspace omits the shell footer. Review entrances use the shared
animation lifecycle with a 240ms fade and no blur, so completed animations clean
up and replay on later section visits. Reduced-motion preferences remain honored.
The progress line represents saved case progress, not the section currently being
viewed; visiting an earlier section does not move saved progress backward.

## Blue accent review, September 15, 2026

- Reviewed customer results, report-upload and confirmation dialogs, checkout,
  completed review, waiting state, intake, and processing in the local fictional
  workspace preview at desktop and mobile sizes. Page backgrounds remain white;
  the checked layouts have no horizontal overflow. Expanded market evidence also
  fits at 320px.
- Verified primary hover and pressed colors, neutral secondary and disabled
  actions, selected radios and appraisal menus, and keyboard focus. Checkbox and
  switch Space interaction remain intact. Blue on white has a 5.17:1 contrast
  ratio; the hover color has a 6.70:1 ratio.
- The palette contract, visual boundary, shared intake, switch, payment, and
  decorative-hover checks pass: 88 tests. Typecheck, contract validation,
  production build, changed-file lint, and whitespace checks pass. The existing
  build warning about large bundles remains.
- Payment fields were simulated; their provider appearance now receives the
  resolved primary token. No hosted deployment or live payment was performed.
