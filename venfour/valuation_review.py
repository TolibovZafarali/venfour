"""Readable report presentation over frozen evidence; no valuation calculations."""
from __future__ import annotations

import html
import ipaddress
import re
import unicodedata
from datetime import date
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit, unquote

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import CondPageBreak, KeepTogether, LongTable, Paragraph, Spacer, TableStyle

from venfour.discrepancy import _median_cents
from venfour.valuation_review_v2 import project_review_context as project_previous_context

TITLE = "Vehicle Valuation Review"
WIDTH = 504
INK = colors.HexColor("#171717")
MUTED = colors.HexColor("#454545")
RULE = colors.HexColor("#d4d4d4")
ACCENT_HEX = "#1d4ed8"  # Existing application brand-strong token.
ACCENT = colors.HexColor(ACCENT_HEX)
TINT = colors.HexColor("#eef4ff")


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


def _recorded_search_scope(result, search, stream):
    request = ((search.get("input") or {}).get(stream + "Request")
               or (result.get(stream + "MarketResult") or {}).get("request") or {})
    # Use only centers actually queried for this evidence stream, not planned areas.
    centers = []
    for event in search.get("events", []):
        operation = event.get("operation") or {}
        center = operation.get("center")
        if operation.get("kind") == "discovery" and operation.get("stream") == stream and operation.get("purpose") == "baseline" and center and center not in centers:
            centers.append(center)
    if centers:
        areas = []
        for center in centers:
            label = f"ZIP {center['postalCode']}" if center.get("id") == "customer" and center.get("postalCode") else center.get("label")
            radius = center.get("radiusMiles")
            if label and isinstance(radius, (int, float)):
                areas.append(f"{radius:g} miles around {label}")
        return (f"{len(centers)} recorded search area{'s' if len(centers) != 1 else ''}: " + "; ".join(areas) + "."
                if len(areas) == len(centers) else "Search-area details are incomplete in the recorded search.")
    if search:
        return "Search-area details were not retained for these observations."
    if request.get("postalCode") and request.get("radiusMiles"):
        return f"{request['radiusMiles']:g} miles around ZIP {request['postalCode']}."
    return "Search-area details were not retained."


def project_review_context(source, assessment):
    context = project_previous_context(source, assessment)
    result = source["analysis"]["artifact"]["result"]
    historical = assessment["evidenceBasis"] == "LOSS_DATE_HISTORICAL"
    search = result.get("marketSearch") or {}
    request = ((search.get("input") or {}).get("historicalRequest" if historical else "currentRequest")
               or (result.get("historicalMarketResult" if historical else "currentMarketResult") or {}).get("request") or {})
    filters = " ".join(str(request[key]) for key in ("year", "make", "model", "trim", "drivetrain") if request.get(key))
    streams = {"historical" if historical else "current"}
    for role in ("primary", "secondary"):
        for row in assessment["externalEvidence"]["selectedComparables"][role]:
            streams.add("historical" if row["facts"]["evidenceBasis"] == "LOSS_DATE_HISTORICAL" else "current")
    context["searchDescription"] = " ".join(
        f"{label} search: {_recorded_search_scope(result, search, stream)}"
        for stream, label in (("historical", "Historical"), ("current", "Current-market"))
        if stream in streams
    )
    origin = (search.get("origin") or {}).get("postalCode") if search else request.get("postalCode")
    context["distanceReference"] = f"ZIP {origin}" if origin else None
    context["searchFilters"] = filters or None
    ranking = result.get("historicalRanking" if historical else "currentRanking") or {}
    components = {key for row in ranking.get("candidates", []) for key in row.get("components", {})}
    labels = [label for key, label in (("year", "year"), ("trim", "trim"), ("mileage", "mileage"), ("distance", "distance")) if key in components]
    context["selectionDescription"] = "Ranked by " + ", ".join(labels) + "; price was not a selection criterion." if labels else None
    primary = [row["facts"] for row in assessment["externalEvidence"]["selectedComparables"]["primary"]]
    vehicle = assessment["subjectVehicle"]
    shared = [key for key in ("year", "make", "model", "trim") if vehicle.get(key) and (key != "trim" or context["trimVerified"]) and primary and all(row.get(key) == vehicle[key] for row in primary)]
    context["sharedVehicleDescription"] = " ".join(str(vehicle[key]) for key in shared) if {"make", "model"}.issubset(shared) else None
    if context["sourceDocumentName"] == "Accepted insurer valuation report (filename not recorded)":
        context["sourceDocumentName"] = "Insurer valuation report (filename not recorded)"
    details = {row["evidenceId"]: row for row in context["comparables"]}
    for role in ("primary", "secondary"):
        for row in assessment["externalEvidence"]["selectedComparables"][role]:
            facts = row["facts"]
            observation_request = (result.get("historicalMarketResult" if facts["evidenceBasis"] == "LOSS_DATE_HISTORICAL" else "currentMarketResult") or {}).get("request") or {}
            observation_origin = (search.get("origin") or {}).get("postalCode") if search else observation_request.get("postalCode")
            details[row["evidenceIds"][0]]["distanceReference"] = f"ZIP {observation_origin}" if observation_origin else None
            if facts.get("drivetrain") and facts.get("lossVehicleDrivetrain") and facts["drivetrain"] != facts["lossVehicleDrivetrain"]:
                details[row["evidenceIds"][0]]["differences"].append(f"Drivetrain: {facts['drivetrain']}; subject: {facts['lossVehicleDrivetrain']}.")
    return context


def readable_date(value):
    parsed = date.fromisoformat(str(value)[:10])
    month = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()[parsed.month - 1]
    return f"{month} {parsed.day}, {parsed.year}"


def provider_name(value):
    known = {"marketcheck": "MarketCheck", "ccc": "CCC", "synthetic-historical": "Fictional historical market records", "synthetic-current": "Fictional current market records"}
    return known.get(str(value).lower(), re.sub(r"[_-]+", " ", str(value)).strip().title())


def validate_comparison_integrity(report):
    """Reject inconsistent frozen evidence; never drop rows or change statistics."""
    from venfour.valuation_evidence_report import ValuationEvidenceReportError
    def reject(reason):
        raise ValuationEvidenceReportError("Comparable evidence requires upstream review: " + reason, code="REPORT_COMPARISON_INTEGRITY_INVALID")
    market = report["independentMarketEvidence"]
    subject_vin = (report["reviewContext"].get("vin") or "").strip().upper()
    for role in ("PRIMARY", "SECONDARY"):
        rows = [row for row in market["comparables"] if row["role"] == role]
        vins, listings = set(), set()
        prices = []
        for row in rows:
            vin = (row.get("vin") or "").strip().upper()
            listing = (row["source"].casefold(), row["sourceListingId"].casefold())
            if vin and vin == subject_vin:
                reject("the subject vehicle appears in the comparable set")
            if (vin and vin in vins) or listing in listings:
                reject("duplicate observations appear within one comparison set")
            if vin: vins.add(vin)
            listings.add(listing)
            try:
                if re.fullmatch(r"\$[\d,]+\.\d{2}", row["advertisedPrice"]) is None:
                    reject("a comparable price cannot be verified")
                prices.append(int(Decimal(row["advertisedPrice"].replace("$", "").replace(",", "")) * 100))
            except (InvalidOperation, ValueError):
                reject("a comparable price cannot be verified")
        summary = market[role.lower()]
        if summary is None:
            if rows: reject("comparable rows have no corresponding statistics")
            continue
        stats = summary["prices"]
        if len(rows) != summary["selectedCount"] or len(rows) != stats["count"]:
            reject("the comparable count does not match the statistics")
        expected = {"minimumPrice": min(prices) if prices else None, "maximumPrice": max(prices) if prices else None, "medianPrice": _median_cents(prices)}
        for key, amount in expected.items():
            actual = stats.get(key)
            if (actual.get("cents") if actual else None) != amount:
                reject("the comparable prices do not match the statistics")
        supported = report["executiveConclusion"]["supportedAdvertisedPriceRange"]
        if role == "PRIMARY" and supported:
            if supported["evidenceBasis"] != summary["evidenceBasis"]:
                reject("the headline range uses a different evidence basis")
            for field, key in (("low", "minimumPrice"), ("median", "medianPrice"), ("high", "maximumPrice")):
                if supported[field]["minorUnits"] != expected[key]:
                    reject("the headline range does not match its comparable set")
    if market["primary"] is None and report["executiveConclusion"]["supportedAdvertisedPriceRange"]:
        reject("a headline range has no comparable set")


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
        "title": ParagraphStyle("ReviewTitle", **{**base, "fontName": "Helvetica-Bold", "fontSize": 25, "leading": 29, "textColor": ACCENT}, spaceAfter=9),
        "heading": ParagraphStyle("ReviewHeading", **{**base, "fontName": "Helvetica-Bold", "fontSize": 13, "leading": 17, "textColor": ACCENT}, spaceBefore=13, spaceAfter=6, keepWithNext=True),
        "body": ParagraphStyle("ReviewBody", **base, fontSize=10.5, spaceAfter=7),
        "small": ParagraphStyle("ReviewSmall", **{**base, "leading": 12}, fontSize=9, spaceAfter=4, allowWidows=False, allowOrphans=False),
        "row": ParagraphStyle("ReviewRow", **{**base, "leading": 12}, fontSize=9, splitLongWords=True),
        "money": ParagraphStyle("ReviewMoney", **{**base, "leading": 13, "fontName": "Helvetica-Bold"}, fontSize=10, alignment=TA_RIGHT),
        "label": ParagraphStyle("ReviewLabel", **{**base, "leading": 12, "fontName": "Helvetica-Bold"}, fontSize=9),
        "ref": ParagraphStyle("ReviewRef", **{**base, "leading": 12, "fontName": "Helvetica-Bold", "textColor": ACCENT}, fontSize=9),
    }


def paragraph(value, style):
    return Paragraph(escaped(value).replace("\n", "<br/>"), style)


def table(rows, widths, st, *, header=True, financial=False, padding=6):
    rendered = [[value if isinstance(value, Paragraph) else paragraph(value, st["label"] if header and i == 0 else st["row"])
                 for value in row] for i, row in enumerate(rows)]
    result = LongTable(rendered, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (-1, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), padding), ("BOTTOMPADDING", (0, 0), (-1, -1), padding),
                ("LINEBELOW", (0, 0), (-1, -1), .4, RULE)]
    if header:
        commands.extend([("LINEBELOW", (0, 0), (-1, 0), .7, ACCENT), ("BACKGROUND", (0, 0), (-1, 0), TINT)])
    if financial:
        commands.extend([("BACKGROUND", (0, 0), (-1, -1), TINT), ("LEFTPADDING", (0, 0), (0, -1), 9), ("RIGHTPADDING", (-1, 0), (-1, -1), 9), ("LINEABOVE", (0, 0), (-1, 0), 1, ACCENT)])
    result.setStyle(TableStyle(commands))
    return result


def _identity(comp):
    return ("vin", comp["vin"].strip().upper()) if comp.get("vin") else (comp["source"].casefold(), comp["sourceListingId"].casefold())


def _identity_keys(comp):
    return {_identity(comp), (comp["source"].casefold(), comp["sourceListingId"].casefold())}


def _existing_ref(comp, refs):
    return next((refs[key] for key in sorted(_identity_keys(comp)) if key in refs), None)


def market_description(report):
    context = report["reviewContext"]
    rows = [row for row in report["independentMarketEvidence"]["comparables"] if row["role"] == "PRIMARY"]
    if not rows:
        return []
    mileages = [row["mileage"] for row in rows if row["mileage"] is not None]
    dates = sorted({row["evidenceDate"] for row in rows})
    providers = ", ".join(dict.fromkeys(provider_name(row["source"]) for row in rows))
    description = [f"Search filters: {context['searchFilters']}." if context.get("searchFilters") else "Original search filters were not retained."]
    if context.get("selectionDescription"): description.append(context["selectionDescription"])
    description.append(context["searchDescription"])
    mileages_text = (f"{min(mileages):,}-{max(mileages):,} miles" if min(mileages) != max(mileages) else f"{mileages[0]:,} miles") if mileages else "not recorded"
    if mileages and len(mileages) != len(rows): mileages_text += " (some mileages missing)"
    dates_text = readable_date(dates[0]) if len(dates) == 1 else f"{readable_date(dates[0])}-{readable_date(dates[-1])}"
    identity_note = "distinct VINs" if all(row.get("vin") for row in rows) else "distinct listing identities"
    description.append(f"Selected: {len(rows)} vehicles ({identity_note}); observed mileages: {mileages_text}. {'Loss-date evidence' if rows[0]['evidenceBasis'] == 'LOSS_DATE_HISTORICAL' else 'Current observations'}: {dates_text}. Source: {providers}.")
    if any(not row.get("vin") for row in rows):
        description.append("Some vehicles lack a VIN; separate listing identifiers do not rule out an unidentified duplicate.")
    return description


def reason_points(report):
    codes = {item["code"] for item in report["findings"]}
    conclusion = report["executiveConclusion"]
    rows = [row for row in report["independentMarketEvidence"]["comparables"] if row["role"] == "PRIMARY"]
    points = []
    if conclusion["insurerValuation"]["value"]["minorUnits"] is None:
        points.append("The insurer's vehicle valuation is not available, so a valuation discrepancy cannot be established.")
    elif conclusion["classification"] in {"INSUFFICIENT_EVIDENCE", "REVIEW_REQUIRED"} or not conclusion["supportedAdvertisedPriceRange"]:
        points.append((f"The review includes {len(rows)} comparable vehicle{'s' if len(rows) != 1 else ''}. " if rows else "No eligible comparable vehicles were available. ") + "This evidence is not sufficient to support a reliable valuation-discrepancy conclusion.")
    elif conclusion["classification"] == "NO_MATERIAL_DISCREPANCY":
        prices = conclusion["supportedAdvertisedPriceRange"]
        points.append(f"The {len(rows)} comparable asking prices range from {prices['low']['display']} to {prices['high']['display']}, compared with the insurer's {conclusion['insurerValuation']['value']['display']} vehicle valuation.")
        points.append("The selected advertised prices do not establish a material discrepancy with the insurer's vehicle valuation.")
    elif "CCC_BELOW_EXTERNAL_RANGE" in codes or "EXTERNAL_MEDIAN_ABOVE_CCC" in codes:
        shared = report["reviewContext"].get("sharedVehicleDescription")
        vehicle = "listings for " + shared + " vehicles" if shared else "comparable listings"
        points.append(f"The {len(rows)} {vehicle} have asking prices " + ("above" if "CCC_BELOW_EXTERNAL_RANGE" in codes else "at a median above") + f" the insurer's {conclusion['insurerValuation']['value']['display']} valuation.")
        mileages = [row["mileage"] for row in rows if row["mileage"] is not None]
        subject = next((fact["value"] for fact in report["subjectVehicle"]["facts"] if fact["key"] == "mileage"), None)
        if mileages and len(mileages) == len(rows) and subject is not None:
            span = f"{min(mileages):,}-{max(mileages):,}" if min(mileages) != max(mileages) else f"{mileages[0]:,}"
            points.append(f"Their mileages are {span} versus {subject:,} for the reviewed vehicle; no mileage dollar adjustments were made.")
    else:
        points.append("The attached evidence should be read with the material qualifications below before drawing a valuation conclusion.")
    if "HISTORICAL_CURRENT_SIGNALS_CONFLICT" in codes:
        points.append("Historical and current-market prices point in different directions. Loss-date evidence remains the primary comparison.")
    if "EXTERNAL_MARKET_HIGH_DISPERSION" in codes:
        points.append("The selected prices vary substantially, limiting the precision of the market comparison.")
    if conclusion["evidenceBasis"] == "CURRENT_MARKET":
        points.append("The comparison uses current asking prices; sufficient verified loss-date market evidence was not available.")
    if conclusion["evidenceStrength"] not in {"STRONG"} and conclusion["evidenceBasis"] != "CURRENT_MARKET" and not any("not sufficient" in item for item in points):
        points.append("The available comparable evidence is limited; it does not establish a precise vehicle value.")
    search = report["independentMarketEvidence"].get("marketSearchContext")
    if search and search["baselineStatus"] == "LIMITED":
        points.append("The comparable search was limited. The evidence may not represent the full relevant market.")
    return list(dict.fromkeys(points))


def _market_rows(comps, prefix, st, details, refs, distance_reference, shared_date):
    rows = [["Ref.", "Comparable vehicle and source", "Advertised price"]]
    for number, comp in enumerate(comps, 1):
        ref = f"{prefix}{number}"
        for key in _identity_keys(comp): refs.setdefault(key, ref)
        detail = details.get(comp["evidenceIds"][0], {})
        mileage = f"{comp['mileage']:,} miles" if comp["mileage"] is not None else "Mileage not recorded"
        differences = list(detail.get("differences", []))
        mileage_note = next((item for item in differences if " miles " in item and "than subject" in item), None)
        if mileage_note:
            mileage += " (" + mileage_note.removesuffix(" than subject.").replace(" miles ", " ") + ")"
            differences.remove(mileage_note)
        origin = detail.get("distanceReference", distance_reference)
        distance = (f" | {comp['distanceMiles']:g} mi from {origin}" if origin else f" | {comp['distanceMiles']:g} mi (origin not recorded)") if comp["distanceMiles"] is not None else ""
        dealer = ", ".join(filter(None, [comp["dealer"], comp["location"]])) or "Dealer/location not recorded"
        identifier = f"VIN {comp['vin']}" if comp["vin"] else f"Listing {comp['sourceListingId']}"
        url = public_listing_url(detail.get("listingUrl"))
        source = escaped(identifier)
        if comp["evidenceDate"] != shared_date:
            source += " | " + escaped(readable_date(comp["evidenceDate"]))
        if url:
            source += f' | <link href="{html.escape(url, quote=True)}" color="{ACCENT_HEX}"><u>View listing</u></link>'
        text = f"<b>{escaped(comp['vehicleDisplay'])}</b><br/>{escaped(mileage + distance)}<br/>{escaped(dealer)}<br/>{source}"
        if differences:
            text += "<br/>" + escaped(" ".join(differences))
        rows.append([paragraph(ref, st["ref"]), Paragraph(text, st["row"]), paragraph(comp["advertisedPrice"], st["money"])])
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
    story = [p("VENFOUR  /  " + ("FICTIONAL TEST DATA - NOT A CUSTOMER REPORT" if fictional else "VALUATION EVIDENCE"), "label"), Spacer(1, 10), p(report["identity"]["title"], "title"), p(context["vehicleDisplay"])]
    info = []
    vehicle_info = [f"VIN: {context['vin']}"] if context.get("vin") else []
    for key, label in (("mileage", "Mileage"), ("lossDate", "Date of loss")):
        fact = facts.get(key)
        if fact and fact["value"] is not None:
            value = f"{fact['value']:,} miles" if key == "mileage" else readable_date(fact["value"])
            (vehicle_info if key == "mileage" else info).append(f"{label}: {value}")
    if vehicle_info: info.insert(0, "  |  ".join(vehicle_info))
    claim_info = []
    for key, label in (("insurerName", "Insurer"), ("claimReference", "Claim")):
        fact = report["insurerValuationReviewed"][key]
        if fact["value"] is not None:
            claim_info.append(f"{label}: {fact['value']}")
    if claim_info: info.append("  |  ".join(claim_info))
    info.append(f"Issued: {readable_date(identity['issueDate'])}  |  Ref. {identity['reportVersionId'][-12:].upper()} / {identity['versionLabel']}")
    story.append(p("\n".join(info), "small"))
    story.append(heading("Valuation comparison"))
    insurer_value = conclusion["insurerValuation"]["value"]
    values = [["Insurer vehicle valuation reviewed", paragraph(insurer_value["display"] if insurer_value["minorUnits"] is not None else "Not recorded", st["money"])]]
    supported = conclusion["supportedAdvertisedPriceRange"]
    if supported:
        values += [["Selected comparable advertised-price range", paragraph(f"{supported['low']['display']} - {supported['high']['display']}", st["money"])], ["Median advertised price", paragraph(supported["median"]["display"], st["money"])]]
    else:
        values.append(["Selected comparable advertised-price range", "Insufficient evidence"])
    story.append(table(values, [310, 194], st, header=False, financial=True))
    story.append(Spacer(1, 7))
    story.append(p("Advertised prices are asking amounts, not verified completed sales or an independently adjusted vehicle value.", "small"))
    for calc in report["adjustmentsAndCalculations"]["calculations"]:
        if calc["code"] == "PRIMARY_EVIDENCE_COMPARISON" and supported and insurer_value["minorUnits"] is not None:
            measures = {row["key"]: row for row in calc["values"]}
            if measures.get("difference", {}).get("value") is not None:
                story.append(p(f"Advertised-price median minus insurer valuation: {measures['difference']['displayValue']} ({measures['differencePercent']['displayValue']}); not a settlement determination.", "small"))
    description = market_description(report)
    if description:
        story.append(heading("Market comparison"))
        story.append(p(" ".join(description), "small"))
    story.append(heading("Reason for review"))
    story.append(p(" ".join(reason_points(report))))
    if not context["trimVerified"]:
        story.append(p("The subject trim was not confirmed by the reviewed records. Trim differences may affect this comparison.", "small"))
    if facts.get("mileage", {}).get("value") is None:
        story.append(p("Subject mileage is unavailable, which limits comparison with the listed vehicles.", "small"))
    if not context.get("vin"):
        story.append(p("The reviewed vehicle's VIN was not available, limiting verification that it is excluded from the listings.", "small"))
    positive = conclusion["classification"] in {"MATERIAL_UNDERVALUE_SIGNAL", "POTENTIAL_UNDERVALUE"} and supported and insurer_value["minorUnits"] is not None
    if not report["insurerComparableReview"]["comparables"]:
        story.append(p("Insurer comparable details were unavailable in the reviewed records, so their adjustments could not be compared.", "small"))
    else:
        story.append(p("Insurer values and adjustments appear below; the records do not fully explain the difference between the two sets.", "small"))
    story.append(p("Please reconsider the vehicle valuation in light of the documented comparable listings. If a different valuation is maintained, please explain the material differences or adjustments supporting it." if positive else "No specific increase is supported by this review. Additional verified evidence may be needed before requesting a revised value."))
    supplied = []
    for key, label in (("condition", "Condition"), ("optionsPackages", "Equipment"), ("priorTitleStatus", "Prior title"), ("existingDamageDescription", "Prior damage")):
        fact = facts.get(key)
        if fact and fact["value"] is not None:
            supplied.append(f"{label}: {fact['displayValue']}")
    if supplied:
        story.append(p("Customer-reported context (not independently inspected): " + "; ".join(supplied) + ".", "small"))
    story.append(heading("Comparable evidence"))
    primary = [comp for comp in market["comparables"] if comp["role"] == "PRIMARY"]
    secondary = [comp for comp in market["comparables"] if comp["role"] == "SECONDARY"]
    details = {item["evidenceId"]: item for item in context["comparables"]}
    refs = {}
    summary = market["primary"]
    if summary and primary:
        historical = summary["evidenceBasis"] == "LOSS_DATE_HISTORICAL"
        story.append(p((f"The figures above use all {len(primary)} comparable vehicles listed below. " if supported else f"All {len(primary)} selected vehicles are listed below; they do not establish a supported price range. ") + (f"Recorded active on {readable_date(summary['evidenceDate'])}, the loss date." if historical else f"Observed {readable_date(summary['evidenceDate'])}; not verified loss-date prices."), "small"))
        story.append(_market_rows(primary, "C", st, details, refs, context.get("distanceReference"), summary["evidenceDate"]))
    else:
        story.append(p("No usable comparable set was available. No market range or revised amount is established."))
    story.extend([CondPageBreak(100), heading("Sources and qualifications")])
    if secondary:
        summary = market["secondary"]
        story.append(p("Current-market context", "label"))
        repeated = [comp for comp in secondary if _existing_ref(comp, refs)]
        distinct = [comp for comp in secondary if not _existing_ref(comp, refs)]
        if repeated:
            shared_date = repeated[0]["evidenceDate"] if len({comp["evidenceDate"] for comp in repeated}) == 1 else None
            observations = "; ".join(f"{_existing_ref(comp, refs)}: {comp['advertisedPrice']}" + (f" on {readable_date(comp['evidenceDate'])}" if not shared_date else "") for comp in repeated)
            if shared_date: observations = f"Observed {readable_date(shared_date)}: " + observations
            story.append(p(observations + ". Source: " + provider_name(summary["provider"]) + ".", "small"))
            story.append(p("These are later observations of the same vehicles, not additional independent vehicles. They are separate from the loss-date comparison and are not combined with its statistics.", "small"))
        if distinct:
            story.append(p(f"Additional vehicles observed {readable_date(summary['evidenceDate'])}; not combined with the headline statistics. Source: {provider_name(summary['provider'])}.", "small"))
            story.append(_market_rows(distinct, "M", st, details, refs, context.get("distanceReference"), summary["evidenceDate"]))
    insurer = report["insurerComparableReview"]["comparables"]
    if insurer:
        story.append(p("Insurer's comparable values", "label"))
        story.append(p("Insurer-reported values, adjustments and contributions; reproduced without independent adjustment or endorsement.", "small"))
        rows = [["Ref.", "Insurer comparable and disclosed adjustments", "Reported values"]]
        for n, comp in enumerate(insurer, 1):
            vehicle_line = comp["vehicleDisplay"]
            if comp["mileage"] is not None: vehicle_line += f" | {comp['mileage']:,} miles"
            source_line = " | ".join(value for value in (f"VIN {comp['vin']}" if comp.get("vin") else None, ", ".join(filter(None, [comp.get("dealer"), comp.get("location")]))) if value)
            lines = [vehicle_line] + ([source_line] if source_line else [])
            adj = [f"{key.title()}: {value}" for key, value in comp["adjustments"].items() if value is not None]
            if comp.get("netAdjustment"): adj.append(f"Net: {comp['netAdjustment']}")
            if comp.get("contributionPercent") is not None: adj.append(f"Insurer contribution: {comp['contributionPercent']}%")
            lines.append("; ".join(adj) if adj else "Adjustment breakdown not supplied.")
            price = comp.get("sourcePrice")
            amounts = ([f"{price['typeLabel']}: {price['amount']}"] if price else [f"Advertised: {comp['advertisedPrice']}"] if comp.get("advertisedPrice") else [])
            if comp.get("adjustedValue"): amounts.append(f"Insurer-adjusted: {comp['adjustedValue']}")
            rows.append([p(f"I{n}", "ref"), p("\n".join(lines), "row"), p("\n".join(amounts) or "Price not recorded", "money")])
        story.append(table(rows, [30, 320, 154], st, padding=5))
    supporting = market.get("higherPricedComparableListings") or {}
    shown = {"vin:" + key[1].casefold() if key[0] == "vin" else f"listing:{key[0]}:{key[1]}".casefold() for key in refs}
    extra = [item for item in supporting.get("listings", []) if item["identity"].casefold() not in shown]
    # Supplemental records remain separate and never alter primary statistics.
    if extra:
        story.append(heading("Supplemental records"))
        story.append(p("The stored supplemental search deliberately sought higher asking prices. These examples are not representative of the market and do not affect the headline range.", "small"))
        for number, item in enumerate(extra, 1):
            public_url = public_listing_url(item.get("listingUrl"))
            source_line = escaped(f"{provider_name(item['source'])}; {readable_date(item['relevantDate'])}; {item['identity']}.")
            if public_url:
                source_line += f' <link href="{html.escape(public_url, quote=True)}" color="{ACCENT_HEX}"><u>View listing</u></link>'
            story.append(KeepTogether([p(f"S{number}. {item['vehicle']} - asking {item['askingPriceDisplay']}", "label"),
                Paragraph(source_line, st["small"]), p(" ".join(item["materialDifferences"] + item["limitations"]), "small")]))
    document = context.get("sourceDocumentName")
    pages = sorted({ref["pageNumber"] for ref in report["sourceEvidenceIndex"] if ref["evidenceLabel"] == "INSURER_EXTRACTED" and ref.get("pageNumber") is not None})
    page_note = "Source pages: " + ", ".join(map(str, pages)) + "." if pages else "Page-specific source citations were not retained."
    story.append(p(f"Insurer source: {document}. " + (f"Report provider: {provider_name(context['sourceProvider'])}. " if context.get("sourceProvider") else "") + page_note if document else "The insurer figure comes from the customer's recorded intake; no source report was retained for this review.", "small"))
    story.append(p("No independent dollar adjustments have been made for mileage, condition, equipment, location, certification or warranty. No physical inspection was performed. This is an evidence review, not an independent appraisal or a determination of the settlement owed.", "small"))
    if market["comparables"]:
        source_note = "Distances are approximate. Live links may change or disappear"
        if any(comp["evidenceBasis"] == "LOSS_DATE_HISTORICAL" for comp in market["comparables"]):
            source_note += " and may not reproduce historical prices. Historical activity is verified by date, not the time of loss"
        source_note += ". The selected vehicles do not represent the entire market."
        story.append(p(source_note, "small"))
    for note in _qualification_notes(report): story.append(p(note, "small"))
    comparison = report["preliminaryVersusFinal"]
    if comparison.get("materialChange"):
        story.append(p("The final review differs materially from the preliminary estimate. This report uses the final reviewed records.", "small"))
    if report.get("productContext"):
        product = report["productContext"]
        story.extend([Spacer(1, 16), p("Location and settlement context", "heading")])
        names = ", ".join(item["name"] for item in product["configurations"]) or "Not yet confirmed"
        story.append(p(f"Recorded locations: {names}. Facts recorded at revision {product['facts_revision']}.", "body"))
        state_names = {"US-" + item["code"]: item["name"] for item in product["configurations"]}
        choices = {"first_party": "Your insurer (first party)", "third_party": "Another person's insurer (third party)", "personal": "Personal", "commercial": "Commercial"}
        for field, label in (("vehicle_registration", "Registration"), ("garaging_at_loss", "Vehicle home at loss"), ("loss_location", "Loss location"), ("policy_issued", "Policy issue state"), ("claim_type", "Claim type"), ("policy_use", "Vehicle use")):
            values = sorted({a["value"] for a in product["facts"]["assertions"] if a["field"] == field and a["value"] is not None})
            display = " / ".join(state_names.get(v, choices.get(v, v)) for v in values) or "Not confirmed"
            story.append(p(f"{label}: {display}" + (" (conflicting sources; review required)" if len(values) > 1 else ""), "small"))
        story.append(p("The comparable search uses Venfour’s local-first market method. Its distance limits are methodology settings, not a claim about a state requirement.", "body"))
        if product["review_reasons"]:
            story.append(p("Location or claim details remain incomplete or require review. No state has been selected over another, and no state-specific rule has been applied.", "body"))
        for component in product["settlement_components"]:
            label = component["component"].replace("_", " ").capitalize()
            story.append(p(f"{label}: treatment has not been verified for this case.", "body"))
        story.append(p("No tax or fee amount has been added to the vehicle comparison. These separate settlement items remain unresolved; this does not mean they are unavailable or legally owed.", "body"))
        story.append(p("Review the report and supporting documents before submitting your request to your insurer. You control all insurer communications.", "body"))
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
            self.setStrokeColor(ACCENT)
            self.setLineWidth(1.5)
            self.line(54, 43, 92, 43)
            self.setFillColor(MUTED)
            self.setFont("Helvetica", 8)
            reference = self._report_identity['reportVersionId'][-12:].upper()
            self.drawString(54, 29, f"Ref. {reference} / {self._report_identity['versionLabel']}" + (" / FICTIONAL TEST DATA" if self._fictional else ""))
            self.drawRightString(558, 29, f"Page {self._pageNumber} of {len(pages)}")
            if self._pageNumber > 1:
                self.setFont("Helvetica", 8)
                self.drawString(54, 765, self._report_identity["title"])
            super().showPage()
        super().save()
