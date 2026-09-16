"""Frozen template-three projection for immutable report replay."""

from venfour.valuation_review_v2 import project_review_context as project_previous_context


def project_review_context(source, assessment):
    context = project_previous_context(source, assessment)
    result = source["analysis"]["artifact"]["result"]
    historical = assessment["evidenceBasis"] == "LOSS_DATE_HISTORICAL"
    search = result.get("marketSearch") or {}
    request = ((search.get("input") or {}).get("historicalRequest" if historical else "currentRequest")
               or (result.get("historicalMarketResult" if historical else "currentMarketResult") or {}).get("request") or {})
    filters = " ".join(str(request[key]) for key in ("year", "make", "model", "trim", "drivetrain") if request.get(key))
    # Use only centers actually queried for this evidence stream, not planned areas.
    stream = "historical" if historical else "current"
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
        context["searchDescription"] = f"{len(centers)} recorded search area{'s' if len(centers) != 1 else ''}: " + "; ".join(areas) + "." if len(areas) == len(centers) else "Search-area details are incomplete in the recorded search."
    elif search:
        context["searchDescription"] = "Search-area details were not retained for these observations."
    elif request.get("postalCode") and request.get("radiusMiles"):
        context["searchDescription"] = f"Recorded search: {request['radiusMiles']:g} miles around ZIP {request['postalCode']}."
    else:
        context["searchDescription"] = "Search-area details were not retained."
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
