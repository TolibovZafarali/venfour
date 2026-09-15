import { useEffect, type ReactNode } from "react";
import { snapshot } from "./state";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const billingCountries = `
  AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
  CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
  GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
  KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
  NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW
  SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
  UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/)
  .map((code) => [code, countryNames.of(code) ?? code] as const)
  .sort(([, left], [, right]) => left.localeCompare(right, "en"));

const billingStates = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
] as const;

export function CheckoutElementsProvider({ children }: { children: ReactNode }) { return children; }
export function BillingAddressElement({ onReady }: { onReady?: () => void }) {
  const empty = snapshot().paymentFieldsEmpty;
  useEffect(() => { onReady?.(); }, [onReady]);
  return <div className="payment-preview" aria-label="Simulated billing fields">
    <label>Cardholder name<input readOnly value={empty ? "" : "Jordan Example"} placeholder="Full name" /></label>
    <label>Country
      <select name="billing-country" autoComplete="country" defaultValue="US">
        {billingCountries.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <label>Address line 1<input readOnly value={empty ? "" : "123 Example Street"} placeholder="Street address" /></label>
    <label>Address line 2<input readOnly value={empty ? "" : "Unit 4"} placeholder="Apartment, suite, etc. (optional)" /></label>
    <label>City<input readOnly value={empty ? "" : "St. Louis"} placeholder="City" /></label>
    <div>
      <label>State
        <select name="billing-state" autoComplete="address-level1" defaultValue={empty ? "" : "MO"}>
          <option value="" disabled>Select state</option>
          {billingStates.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>ZIP code<input readOnly value={empty ? "" : "63101"} placeholder="ZIP code" /></label>
    </div>
  </div>;
}
export function PaymentElement({ onReady }: { onReady?: () => void }) {
  const empty = snapshot().paymentFieldsEmpty;
  useEffect(() => { onReady?.(); }, [onReady]);
  return <div className="payment-preview" aria-label="Simulated payment fields">
    <p>Payment preview · no transaction</p>
    <label>Card number<input readOnly value={empty ? "" : "4242 4242 4242 4242"} placeholder="1234 1234 1234 1234" /></label>
    <div><label>Expiration<input readOnly value={empty ? "" : "12 / 30"} placeholder="MM / YY" /></label><label>Security code<input readOnly value={empty ? "" : "•••"} placeholder="CVC" /></label></div>
  </div>;
}
