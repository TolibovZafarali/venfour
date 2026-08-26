import { describe, expect, it } from "vitest";

import {
  uniquelyMatchingVehicleTrimOption,
  vehicleConfigurationFromTrimOption,
  vehicleConfigurationIdentity,
  type VehicleTrimOption,
} from "@/features/intake/vehicle-lookup-types";

const longRangeAwd: VehicleTrimOption = {
  source: "marketcheck",
  id: "marketcheck-version-long-range-awd",
  label: "Long Range Dual Motor AWD",
  trim: "Long Range Dual Motor AWD",
  queryField: "version",
  queryValues: [
    "Dual Motor All-Whel Drive Long Range",
    "Long Range AWD Dual Motor",
  ],
};

describe("vehicle configuration identity", () => {
  it("copies the exact raw provider identity from a display option", () => {
    const configuration = vehicleConfigurationFromTrimOption(longRangeAwd);

    expect(configuration).toEqual({
      source: "marketcheck",
      field: "version",
      values: [
        "Dual Motor All-Whel Drive Long Range",
        "Long Range AWD Dual Motor",
      ],
    });
    if (!configuration) throw new Error("expected MarketCheck configuration");
    expect(configuration.values).not.toBe(longRangeAwd.queryValues);
  });

  it("keeps generated display trims out of MarketCheck query identity", () => {
    expect(
      vehicleConfigurationFromTrimOption({
        ...longRangeAwd,
        source: "openai",
        id: "openai-trim-long-range",
        label: "Long Range",
        trim: "Long Range",
        queryField: "trim",
        queryValues: ["Long Range"],
      }),
    ).toBeNull();
  });

  it("accepts only the bounded canonical persistence shape", () => {
    expect(
      vehicleConfigurationIdentity({
        source: "marketcheck",
        field: "trim",
        values: ["XLE", "XLE AWD"],
      }),
    ).toEqual({
      source: "marketcheck",
      field: "trim",
      values: ["XLE", "XLE AWD"],
    });

    for (const value of [
      { source: "marketcheck", field: "engine", values: ["2.0L"] },
      { source: "MarketCheck", field: "trim", values: ["XLE"] },
      { source: "marketcheck", field: "trim", values: [" XLE"] },
      { source: "marketcheck", field: "trim", values: ["XLE", "xle"] },
      { source: "marketcheck", field: "trim", values: ["XLE\u202e AWD"] },
      {
        source: "marketcheck",
        field: "trim",
        values: Array.from({ length: 21 }, (_, index) => `Alias ${index}`),
      },
    ]) {
      expect(vehicleConfigurationIdentity(value)).toBeNull();
    }
  });

  it("resolves legacy labels only when one configuration matches", () => {
    const longRangeRwd: VehicleTrimOption = {
      ...longRangeAwd,
      id: "marketcheck-version-long-range-rwd",
      label: "Long Range RWD",
      trim: "Long Range RWD",
      queryValues: ["Long Range Rear Wheel Drive"],
    };
    const duplicateLabel: VehicleTrimOption = {
      ...longRangeAwd,
      id: "marketcheck-version-long-range-awd-duplicate",
    };

    expect(
      uniquelyMatchingVehicleTrimOption(
        [longRangeRwd, longRangeAwd],
        "Long Range AWD Dual Motor",
      ),
    ).toBe(longRangeAwd);
    expect(
      uniquelyMatchingVehicleTrimOption(
        [longRangeAwd, duplicateLabel],
        "Long Range Dual Motor AWD",
      ),
    ).toBeNull();
    expect(
      uniquelyMatchingVehicleTrimOption(
        [longRangeRwd, longRangeAwd],
        longRangeAwd.trim,
        vehicleConfigurationFromTrimOption(longRangeAwd),
      ),
    ).toBe(longRangeAwd);
  });

  it("refreshes a renamed canonical label from an unchanged raw identity", () => {
    const renamed = {
      ...longRangeAwd,
      label: "Long Range AWD",
      trim: "Long Range AWD",
    };

    expect(
      uniquelyMatchingVehicleTrimOption(
        [renamed],
        "Long Range Dual Motor AWD",
        vehicleConfigurationFromTrimOption(longRangeAwd),
      ),
    ).toBe(renamed);
  });
});
