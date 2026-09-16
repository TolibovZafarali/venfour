"""Readable report presentation over frozen evidence; no valuation calculations."""
from __future__ import annotations

import html
import ipaddress
import re
import unicodedata
from urllib.parse import urlsplit, unquote

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import KeepTogether, LongTable, PageBreak, Paragraph, Spacer, TableStyle

TITLE = "Vehicle Valuation Review"
WIDTH = 504
INK = colors.HexColor("#171717")
MUTED = colors.HexColor("#454545")
RULE = colors.HexColor("#d4d4d4")


def public_listing_url(value):
    """Allow credential-free public HTTP links, never private/signed locations."""
    if not isinstance(value, str) or not value or len(value) > 2048:
        return None
    try:
        parts = urlsplit(value)
        host = parts.hostname or ""
        if parts.scheme not in {"https", "http"} or not host or parts.username or parts.password:
            return None
        if parts.query or parts.fragment or parts.port not in {None, 80, 443}:
            return None
        if host.lower() == "localhost" or host.lower().endswith((".local", ".internal", ".supabase.co", ".supabase.in")):
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            pass
        decoded = unquote(parts.path).lower()
        if any(word in decoded for word in ("/storage/", "/private/", "/signed/", "token", "credential", "secret")):
            return None
        if any(ord(char) < 32 or char in '<>"\\' for char in value):
            return None
        return value
    except ValueError:
        return None


def project_review_context(source, assessment):
    normalized = (source.get("extraction") or {}).get("normalizedReport") or {}
    vehicle = assessment["subjectVehicle"]
    extracted = normalized.get("vehicle") or {}
    verified_trim = bool(vehicle.get("trim") and extracted.get("trim") == vehicle["trim"])
    display = " ".join(str(vehicle[key]) for key in ("year", "make", "model", "trim")
                       if vehicle.get(key) is not None and (key != "trim" or verified_trim))
    result = source["analysis"]["artifact"]["result"]
    details = []
    for role in ("primary", "secondary"):
        for row in assessment["externalEvidence"]["selectedComparables"][role]:
            facts = row["facts"]
            ranking = result.get("historicalRanking" if facts["evidenceBasis"] == "LOSS_DATE_HISTORICAL" else "currentRanking") or {}
            matches = [candidate["listing"] for candidate in ranking.get("candidates", [])
                       if candidate["listing"].get("source") == facts["source"]
                       and candidate["listing"].get("sourceListingId") == facts["sourceListingId"]
                       and candidate["listing"].get("vin") == facts.get("vin")]
            urls = {public_listing_url(item.get("listingUrl")) for item in matches}
            url = next(iter(urls)) if len(urls) == 1 else None
            differences = []
            for key, label in (("year", "Year"), ("trim", "Trim")):
                if facts.get(key) is not None and vehicle.get(key) is not None and facts[key] != vehicle[key]:
                    differences.append(f"{label}: {facts[key]}; subject: {vehicle[key]}.")
            if facts.get("trim") is None:
                differences.append("Comparable trim was not recorded.")
            difference = facts.get("mileageDifferenceFromLossVehicle")
            if difference:
                differences.append(f"{abs(difference):,} miles {'higher' if difference > 0 else 'lower'} than subject.")
            config = facts.get("configuration") or {}
            if config.get("drivetrain") and config.get("lossVehicleDrivetrain") and config["drivetrain"] != config["lossVehicleDrivetrain"]:
                differences.append(f"Drivetrain: {config['drivetrain']}; subject: {config['lossVehicleDrivetrain']}.")
            details.append({"evidenceId": row["evidenceIds"][0], "listingUrl": url, "differences": differences})
    search = result.get("marketSearch") or {}
    centers = search.get("centers") or []
    radii = sorted({center["radiusMiles"] for center in centers if isinstance(center.get("radiusMiles"), (int, float))})
    search_description = None
    if radii:
        search_description = f"The recorded search used {len(centers)} search area{'s' if len(centers) != 1 else ''}, with " + ", ".join(f"{radius:g}-mile" for radius in radii) + " radii around those search centers."
    elif result.get("currentMarketResult"):
        radius = result["currentMarketResult"].get("request", {}).get("radiusMiles")
        if isinstance(radius, (int, float)):
            search_description = f"The recorded current-market search radius was {radius:g} miles."
    return {"vehicleDisplay": display, "trimVerified": verified_trim,
            "vin": vehicle.get("vin") or extracted.get("vin"),
            "sourceDocumentName": (source.get("sourceDocument") or {}).get("originalFilename") or ("Accepted insurer valuation report (filename not recorded)" if normalized else None),
            "sourceProvider": (source.get("extraction") or {}).get("provider"),
            "comparables": details, "searchDescription": search_description}


def clean(value):
    text = str(value).replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-")
    text = "".join(char for char in text if ord(char) >= 32 or char in "\n\t")
    text = unicodedata.normalize("NFC", text.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"'))
    # Standard PDF fonts use WinAnsi; refuse unsupported glyphs instead of tofu.
    text.encode("cp1252")
    return text


def escaped(value):
    return html.escape(clean(value))


def styles():
    base = dict(fontName="Helvetica", textColor=INK, leading=14)
    return {
        "title": ParagraphStyle("ReviewTitle", **{**base, "fontName": "Helvetica-Bold", "fontSize": 25, "leading": 29}, spaceAfter=9),
        "heading": ParagraphStyle("ReviewHeading", **{**base, "fontName": "Helvetica-Bold", "fontSize": 13, "leading": 17}, spaceBefore=14, spaceAfter=7, keepWithNext=True),
        "body": ParagraphStyle("ReviewBody", **base, fontSize=10.5, spaceAfter=7),
        "small": ParagraphStyle("ReviewSmall", **{**base, "leading": 12}, fontSize=9, spaceAfter=4),
        "row": ParagraphStyle("ReviewRow", **{**base, "leading": 12}, fontSize=9, splitLongWords=True),
        "money": ParagraphStyle("ReviewMoney", **{**base, "leading": 13, "fontName": "Helvetica-Bold"}, fontSize=10, alignment=TA_RIGHT),
        "label": ParagraphStyle("ReviewLabel", **{**base, "leading": 12, "fontName": "Helvetica-Bold"}, fontSize=9),
    }


def paragraph(value, style):
    return Paragraph(escaped(value).replace("\n", "<br/>"), style)


def table(rows, widths, st, *, header=True):
    rendered = [[value if isinstance(value, Paragraph) else paragraph(value, st["label"] if header and i == 0 else st["row"])
                 for value in row] for i, row in enumerate(rows)]
    result = LongTable(rendered, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (-1, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LINEBELOW", (0, 0), (-1, -1), .4, RULE)]
    if header:
        commands.append(("LINEBELOW", (0, 0), (-1, 0), .7, INK))
    result.setStyle(TableStyle(commands))
    return result


def _identity(comp):
    return ("vin", comp["vin"].upper()) if comp.get("vin") else (comp["source"], comp["sourceListingId"])


def reason_points(report):
    codes = {item["code"] for item in report["findings"]}
    conclusion = report["executiveConclusion"]
    points = []
    if conclusion["insurerValuation"]["value"]["minorUnits"] is None:
        points.append("The insurer's vehicle valuation is not available, so a valuation discrepancy cannot be established.")
    elif conclusion["classification"] in {"INSUFFICIENT_EVIDENCE", "REVIEW_REQUIRED"} or not conclusion["supportedAdvertisedPriceRange"]:
        points.append("The available evidence is not sufficient to support a reliable valuation-discrepancy conclusion.")
    elif conclusion["classification"] == "NO_MATERIAL_DISCREPANCY":
        points.append("The selected advertised prices do not establish a material discrepancy with the insurer's vehicle valuation.")
    elif "CCC_BELOW_EXTERNAL_RANGE" in codes:
        points.append("The insurer's vehicle valuation is below the advertised price of every vehicle in the selected primary comparison set.")
    elif "EXTERNAL_MEDIAN_ABOVE_CCC" in codes:
        points.append("The insurer's vehicle valuation is below the median advertised price of the selected primary comparables.")
    else:
        points.append("The attached evidence should be read with the material qualifications below before drawing a valuation conclusion.")
    if "HISTORICAL_CURRENT_SIGNALS_CONFLICT" in codes:
        points.append("Historical and current-market prices point in different directions. Loss-date evidence remains the primary comparison.")
    if "EXTERNAL_MARKET_HIGH_DISPERSION" in codes:
        points.append("The selected prices vary substantially, limiting the precision of the market comparison.")
    if conclusion["evidenceBasis"] == "CURRENT_MARKET":
        points.append("The comparison uses current asking prices; sufficient verified loss-date market evidence was not available.")
    if conclusion["evidenceStrength"] not in {"STRONG"} and not any("not sufficient" in item for item in points):
        points.append("The available comparable evidence is limited; it does not establish a precise vehicle value.")
    search = report["independentMarketEvidence"].get("marketSearchContext")
    if search and search["baselineStatus"] == "LIMITED":
        points.append("The comparable search was limited. The evidence may not represent the full relevant market.")
    return list(dict.fromkeys(points))


def _market_rows(comps, prefix, st, details, refs):
    rows = [["Ref.", "Comparable vehicle and source", "Advertised price"]]
    for number, comp in enumerate(comps, 1):
        ref = f"{prefix}{number}"
        refs.setdefault(_identity(comp), ref)
        detail = details.get(comp["evidenceIds"][0], {})
        mileage = f"{comp['mileage']:,} miles" if comp["mileage"] is not None else "Mileage not recorded"
        differences = list(detail.get("differences", []))
        mileage_note = next((item for item in differences if " miles " in item and "than subject" in item), None)
        if mileage_note:
            mileage += " (" + mileage_note.removesuffix(" than subject.").replace(" miles ", " ") + ")"
            differences.remove(mileage_note)
        distance = f" | {comp['distanceMiles']:g} miles away" if comp["distanceMiles"] is not None else ""
        dealer = ", ".join(filter(None, [comp["dealer"], comp["location"]])) or "Dealer/location not recorded"
        identifier = f"VIN {comp['vin']}" if comp["vin"] else f"Listing {comp['sourceListingId']}"
        url = public_listing_url(detail.get("listingUrl"))
        source = escaped(identifier)
        if url:
            source += f' | <link href="{html.escape(url, quote=True)}" color="#171717"><u>View listing</u></link>'
        text = f"<b>{escaped(comp['vehicleDisplay'])}</b><br/>{escaped(mileage + distance)}<br/>{escaped(dealer)}<br/>{source}"
        if differences:
            text += "<br/>" + escaped(" ".join(differences))
        rows.append([ref, Paragraph(text, st["row"]), paragraph(comp["advertisedPrice"], st["money"])])
    return table(rows, [30, 360, 114], st)


def _qualification_notes(report):
    covered = {"NO_PHYSICAL_VEHICLE_INSPECTION", "NOT_AN_INDEPENDENT_APPRAISAL", "DOES_NOT_CALCULATE_LEGAL_SETTLEMENT", "POLICY_THRESHOLDS_NOT_LEGAL_STANDARDS", "NEGOTIATION_OUTPUT_NOT_INCLUDED", "ADVERTISED_PRICES_NOT_TRANSACTIONS", "NO_INDEPENDENT_MILEAGE_ADJUSTMENT", "NO_INDEPENDENT_CONDITION_ADJUSTMENT", "NO_INDEPENDENT_OPTIONS_ADJUSTMENT", "PROVIDER_COVERAGE_LIMITED", "CURRENT_LISTINGS_NOT_LOSS_DATE_EVIDENCE", "HISTORICAL_DATE_LEVEL_ONLY", "BOUNDED_EXTERNAL_COMPARISON_SET", "MARKET_SEARCH_LIMITED"}
    notes = []
    for item in report["assumptionsAndLimitations"]["assumptions"] + report["assumptionsAndLimitations"]["limitations"]:
        if item["code"] not in covered:
            notes.append(item["description"])
    return notes


def build_story(report, *, fictional=False):
    st = styles()
    p = lambda text, style="body": paragraph(text, st[style])
    heading = lambda text: p(text, "heading")
    context = report["reviewContext"]
    conclusion = report["executiveConclusion"]
    market = report["independentMarketEvidence"]
    facts = {fact["key"]: fact for fact in report["subjectVehicle"]["facts"]}
    identity = report["identity"]
    story = [p("VENFOUR  /  " + ("FICTIONAL TEST DATA - NOT A CUSTOMER REPORT" if fictional else "VALUATION EVIDENCE"), "label"), Spacer(1, 10), p(TITLE, "title"), p(context["vehicleDisplay"])]
    info = []
    if context.get("vin"):
        info.append(f"VIN: {context['vin']}")
    for key, label in (("mileage", "Mileage"), ("lossDate", "Date of loss")):
        fact = facts.get(key)
        if fact and fact["value"] is not None:
            value = f"{fact['value']:,} miles" if key == "mileage" else str(fact["value"])
            info.append(f"{label}: {value}")
    for key, label in (("insurerName", "Insurer"), ("claimReference", "Claim")):
        fact = report["insurerValuationReviewed"][key]
        if fact["value"] is not None:
            info.append(f"{label}: {fact['value']}")
    info.append(f"Issued: {identity['issueDate']}")
    story.append(p("\n".join(info), "small"))
    story.append(heading("Valuation comparison"))
    insurer_value = conclusion["insurerValuation"]["value"]
    values = [["Insurer vehicle valuation reviewed", paragraph(insurer_value["display"] if insurer_value["minorUnits"] is not None else "Not recorded", st["money"])]]
    supported = conclusion["supportedAdvertisedPriceRange"]
    if supported:
        values += [["Selected comparable advertised-price range", paragraph(f"{supported['low']['display']} - {supported['high']['display']}", st["money"])], ["Median advertised price", paragraph(supported["median"]["display"], st["money"])]]
    else:
        values.append(["Selected comparable advertised-price range", "Insufficient evidence"])
    story.append(table(values, [310, 194], st, header=False))
    story.append(Spacer(1, 7))
    story.append(p("Advertised prices are asking amounts, not verified completed sales or an independently adjusted vehicle value.", "small"))
    for calc in report["adjustmentsAndCalculations"]["calculations"]:
        if calc["code"] == "PRIMARY_EVIDENCE_COMPARISON" and supported and insurer_value["minorUnits"] is not None:
            measures = {row["key"]: row for row in calc["values"]}
            if measures.get("difference", {}).get("value") is not None:
                story.append(p(f"Advertised-price median minus insurer valuation: {measures['difference']['displayValue']} ({measures['differencePercent']['displayValue']}). This comparison is not an established underpayment.", "small"))
    story.append(heading("Reason for review"))
    for point in reason_points(report):
        story.append(p(point))
    if not context["trimVerified"]:
        story.append(p("The subject trim was not confirmed by the accepted report. Trim differences may affect this comparison.", "small"))
    if facts.get("mileage", {}).get("value") is None:
        story.append(p("Subject mileage is unavailable, which limits comparison with the listed vehicles.", "small"))
    positive = conclusion["classification"] in {"MATERIAL_UNDERVALUE_SIGNAL", "POTENTIAL_UNDERVALUE"} and supported and insurer_value["minorUnits"] is not None
    story.append(p("Please review the documented listings alongside the insurer's vehicle valuation and explain any material adjustments or differences that affect your conclusion." if positive else "No specific increase is supported by this review. Additional verified evidence may be needed before requesting a revised value."))
    supplied = []
    for key, label in (("condition", "Condition"), ("optionsPackages", "Equipment"), ("priorTitleStatus", "Prior title"), ("existingDamageDescription", "Prior damage")):
        fact = facts.get(key)
        if fact and fact["value"] is not None:
            supplied.append(f"{label}: {fact['displayValue']}")
    if supplied:
        story.append(p("Customer-reported context (not independently inspected): " + "; ".join(supplied) + ".", "small"))
    story.append(p("No independent dollar adjustments have been made for mileage, condition, equipment or location. No physical inspection was performed. This is an evidence review, not an independent appraisal or a determination of the settlement owed.", "small"))

    story += ([PageBreak()] if market["comparables"] else []) + [heading("Comparable evidence")]
    primary = [comp for comp in market["comparables"] if comp["role"] == "PRIMARY"]
    secondary = [comp for comp in market["comparables"] if comp["role"] == "SECONDARY"]
    details = {item["evidenceId"]: item for item in context["comparables"]}
    refs = {}
    summary = market["primary"]
    if summary and primary:
        historical = summary["evidenceBasis"] == "LOSS_DATE_HISTORICAL"
        story.append(p(f"C1-C{len(primary)} is the complete selected primary set" + (" underlying the headline statistics. " if supported else ". It is not sufficient to establish a supported price range. ") + (f"Recorded as active on the loss date, {summary['evidenceDate']}." if historical else f"Current-market observations dated {summary['evidenceDate']}; not verified loss-date prices.")))
        story.append(p(f"Source: {summary['provider']}. Selection is based on vehicle comparability, not price. No independent dollar adjustments were applied.", "small"))
        story.append(_market_rows(primary, "C", st, details, refs))
    else:
        story.append(p("No complete eligible primary comparable set was available. No market range or revised amount is established."))
    story += ([PageBreak()] if market["comparables"] else []) + [heading("Sources and qualifications")]
    if secondary:
        summary = market["secondary"]
        story.append(heading("Current-market context"))
        story.append(p(f"Observed {summary['evidenceDate']}. These records are separate from the primary comparison and are not combined with its statistics.", "small"))
        repeated = [comp for comp in secondary if _identity(comp) in refs]
        distinct = [comp for comp in secondary if _identity(comp) not in refs]
        if repeated:
            observations = "; ".join(f"{refs[_identity(comp)]}: {comp['advertisedPrice']}" for comp in repeated)
            story.append(p(observations + ". Source: " + summary["provider"] + ".", "small"))
            story.append(p("These are later observations of vehicles already identified above, not additional independent vehicles.", "small"))
        if distinct:
            story.append(_market_rows(distinct, "M", st, details, refs))
    insurer = report["insurerComparableReview"]["comparables"]
    if insurer:
        story.append(heading("Insurer's comparable values"))
        story.append(p("The following figures reproduce the insurer's report. Adjustments and contributions are the insurer's, not independently endorsed or recalculated here.", "small"))
        rows = [["Ref.", "Insurer comparable and disclosed adjustments", "Reported values"]]
        for n, comp in enumerate(insurer, 1):
            lines = [comp["vehicleDisplay"]]
            if comp["mileage"] is not None: lines.append(f"{comp['mileage']:,} miles")
            lines += [value for value in (comp.get("vin"), ", ".join(filter(None, [comp.get("dealer"), comp.get("location")]))) if value]
            adj = [f"{key.title()}: {value}" for key, value in comp["adjustments"].items() if value is not None]
            if comp.get("netAdjustment"): adj.append(f"Net: {comp['netAdjustment']}")
            if comp.get("contributionPercent") is not None: adj.append(f"Insurer contribution: {comp['contributionPercent']}%")
            lines.append("; ".join(adj) if adj else "Adjustment breakdown not supplied.")
            price = comp.get("sourcePrice")
            amounts = ([f"{price['typeLabel']}: {price['amount']}"] if price else [f"Advertised: {comp['advertisedPrice']}"] if comp.get("advertisedPrice") else [])
            if comp.get("adjustedValue"): amounts.append(f"Insurer-adjusted: {comp['adjustedValue']}")
            rows.append([f"I{n}", p("\n".join(lines), "row"), p("\n".join(amounts) or "Price not recorded", "money")])
        story.append(table(rows, [30, 320, 154], st))
    else:
        story.append(p("No insurer comparable rows were available in the accepted evidence; the insurer's comparable adjustments could not be reviewed.", "small"))
    supporting = market.get("higherPricedComparableListings") or {}
    shown = {"vin:" + key[1].casefold() if key[0] == "vin" else f"listing:{key[0]}:{key[1]}".casefold() for key in refs}
    extra = [item for item in supporting.get("listings", []) if item["identity"].casefold() not in shown]
    # Supplemental records remain separate and never alter primary statistics.
    if extra:
        story.append(heading("Supplemental records"))
        story.append(p("The stored supplemental search deliberately sought higher asking prices. These examples are not representative of the market and do not affect the headline range.", "small"))
        for number, item in enumerate(extra, 1):
            public_url = public_listing_url(item.get("listingUrl"))
            source_line = escaped(f"{item['source']}; {item['relevantDate']}; {item['identity']}.")
            if public_url:
                source_line += f' <link href="{html.escape(public_url, quote=True)}" color="#171717"><u>View listing</u></link>'
            story.append(KeepTogether([p(f"S{number}. {item['vehicle']} - asking {item['askingPriceDisplay']}", "label"),
                Paragraph(source_line, st["small"]), p(" ".join(item["materialDifferences"] + item["limitations"]), "small")]))
    story.append(heading("Source notes"))
    document = context.get("sourceDocumentName")
    pages = sorted({ref["pageNumber"] for ref in report["sourceEvidenceIndex"] if ref["evidenceLabel"] == "INSURER_EXTRACTED" and ref.get("pageNumber") is not None})
    page_note = "Source pages: " + ", ".join(map(str, pages)) + "." if pages else "Page-specific source citations were not retained."
    story.append(p(f"Insurer source: {document}. " + (f"Report provider: {context['sourceProvider']}. " if context.get("sourceProvider") else "") + page_note if document else "The insurer figure comes from the customer's recorded intake; no source report was retained for this review.", "small"))
    if report["insurerValuationReviewed"]["claimReference"]["value"]:
        story.append(p("The claim reference is extracted from the accepted insurer report.", "small"))
    if context["searchDescription"]: story.append(p(context["searchDescription"], "small"))
    if market["comparables"]:
        source_note = "Listing identifiers and available source links are provided with the comparable records. A live listing may have changed or disappeared."
        if any(comp["evidenceBasis"] == "LOSS_DATE_HISTORICAL" for comp in market["comparables"]):
            source_note += " It may not reproduce its historical price. Historical activity is verified at calendar-date level, not the exact time of loss."
        story.append(p(source_note, "small"))
    if market["comparables"]:
        story.append(p("The statistics use the complete selected set, rather than every listing discovered. Provider records may not capture the entire market. Certification, warranty and optional accessory benefits have not been independently valued.", "small"))
    for note in _qualification_notes(report): story.append(p(note, "small"))
    comparison = report["preliminaryVersusFinal"]
    if comparison.get("materialChange"):
        story.append(p("The final review differs materially from the preliminary estimate. This report uses the final accepted evidence.", "small"))
    return story


class NumberedCanvas(Canvas):
    """Replay recorded pages once their total is known, preserving link objects."""
    def __init__(self, *args, report_identity, fictional=False, **kwargs):
        kwargs.update(invariant=1, pageCompression=1)
        super().__init__(*args, **kwargs)
        self._saved_pages = []
        self._report_identity = report_identity
        self._fictional = fictional

    def showPage(self):
        self._saved_pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        pages = self._saved_pages
        for state in pages:
            self.__dict__.update(state)
            self.setStrokeColor(RULE)
            self.line(54, 43, 558, 43)
            self.setFillColor(MUTED)
            self.setFont("Helvetica", 8)
            reference = self._report_identity['reportVersionId'][-12:].upper()
            self.drawString(54, 29, f"Ref. {reference} / {self._report_identity['versionLabel']}" + (" / FICTIONAL TEST DATA" if self._fictional else ""))
            self.drawRightString(558, 29, f"Page {self._pageNumber} of {len(pages)}")
            if self._pageNumber > 1:
                self.setFont("Helvetica", 8)
                self.drawString(54, 765, TITLE)
            super().showPage()
        super().save()
