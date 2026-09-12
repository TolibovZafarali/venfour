import type { SubjectVehicleFacts } from "./vehicle-facts";

// Only explicit decoded specifications are carried into the editable intake.
export function decodedVehicleFacts(row: Record<string, unknown>): SubjectVehicleFacts {
  const text = (key: string) => {
    const value = row[key];
    if (typeof value !== "string" || value.length > 200 || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return "";
    const normalized = value.trim().replace(/\s+/gu, " ");
    return /^(unknown|not applicable|not available|n\/a|other)$/iu.test(normalized) ? "" : normalized;
  };
  const facts: SubjectVehicleFacts = {};
  const body = text("BodyClass");
  const bodyNames: Record<string, string> = {
    "Sedan/Saloon": "Sedan", "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)": "SUV",
    "Hatchback/Liftback/Notchback": "Hatchback", "Convertible/Cabriolet": "Convertible",
    Coupe: "Coupe", Pickup: "Pickup", Wagon: "Wagon", Minivan: "Minivan", Van: "Van",
  };
  const bodyKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim().replace(/multi purpose/gu, "multipurpose");
  const canonicalBody = Object.entries(bodyNames).find(([name]) => bodyKey(name) === bodyKey(body))?.[1];
  if (canonicalBody) facts.bodyType = canonicalBody;
  const driveNames: Record<string, string> = {
    "FWD/Front-Wheel Drive": "FWD", "RWD/Rear-Wheel Drive": "RWD",
    "AWD/All-Wheel Drive": "AWD", "4WD/4-Wheel Drive/4x4": "4WD",
  };
  if (driveNames[text("DriveType")]) facts.drivetrain = driveNames[text("DriveType")];

  const primary = text("FuelTypePrimary");
  const secondary = text("FuelTypeSecondary");
  const fuels: Record<string, string> = { Gasoline: "Unleaded", Diesel: "Diesel", Electric: "Electric" };
  if (fuels[primary] && (!secondary || secondary === primary)) facts.fuelType = fuels[primary];
  if ([primary, secondary].includes("Gasoline") && [primary, secondary].includes("Electric")) facts.fuelType = "Electric / Unleaded";

  const transmissions: Record<string, string> = {
    Automatic: "Automatic", "Manual/Standard": "Manual", "Continuously Variable Transmission (CVT)": "CVT",
    "Automated Manual Transmission (AMT)": "Automated Manual", "Dual-Clutch Transmission (DCT)": "Dual Clutch",
  };
  if (transmissions[text("TransmissionStyle")]) facts.transmission = transmissions[text("TransmissionStyle")];
  const cylinders = text("EngineCylinders");
  const displacement = text("DisplacementL");
  const layout = ({ "In-Line": "I", "V-Shaped": "V", "Horizontally opposed (boxer)": "H" } as Record<string, string>)[text("EngineConfiguration")];
  if (/^[1-9][0-9]?$/u.test(cylinders)) facts.cylinders = cylinders;
  const engineParts: string[] = [];
  if (/^\d+(?:\.\d+)?$/u.test(displacement) && Number(displacement) > 0 && Number(displacement) < 20) {
    const litres = Number.isInteger(Number(displacement)) ? Number(displacement).toFixed(1) : String(Number(displacement));
    engineParts.push(`${litres}L`);
  }
  if (facts.cylinders) engineParts.push(layout ? `${layout}${cylinders}` : `${cylinders} cylinders`);
  if (text("Turbo") === "Yes") engineParts.push("Turbo");
  if (text("Turbo") === "No") engineParts.push("Naturally aspirated");
  const family = text("EngineModel");
  // Preserve a recorded family name without discarding partial specifications
  // or presenting the name as a complete technical configuration.
  if (family && !/[/;]/u.test(family)) engineParts.push(engineParts.length ? `(family: ${family})` : family);
  const engine = engineParts.join(" ");
  if (engine && engine.length <= 200) facts.engine = engine;
  const doors = text("Doors");
  if (/^[1-9]$/u.test(doors)) facts.doors = doors;
  const cab = text("BodyCabType");
  if (cab && !/[/;]/u.test(cab)) facts.cabType = cab;
  const bed = text("BedLengthIN");
  if (/^\d+(?:\.\d+)?$/u.test(bed) && Number(bed) > 0) facts.bedLength = `${Number(bed)} in`;
  return facts;
}
