const wholeNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const distanceFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const unavailable = "Not available";

export function formatWholeNumber(value: number | null) {
  return value === null ? unavailable : wholeNumberFormatter.format(value);
}

export function formatMileage(value: number | null) {
  return value === null ? unavailable : `${formatWholeNumber(value)} miles`;
}

export function formatDistance(value: number | null) {
  return value === null ? unavailable : `${distanceFormatter.format(value)} miles`;
}

export function formatMoneyCents(value: number) {
  return moneyFormatter.format(value / 100);
}

export function formatDate(value: string | null) {
  if (!value) {
    return unavailable;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return unavailable;
  }

  const [, year, month, day] = match;
  return dateFormatter.format(
    new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))),
  );
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return unavailable;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? unavailable
    : dateTimeFormatter.format(date);
}

export function formatMileageDifference(value: number | null) {
  if (value === null) {
    return unavailable;
  }
  if (value === 0) {
    return "Same mileage as the loss vehicle";
  }

  return `${formatWholeNumber(Math.abs(value))} miles ${
    value > 0 ? "higher" : "lower"
  } than the loss vehicle`;
}

export function joinPresent(values: Array<string | null>) {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length > 0 ? present.join(", ") : unavailable;
}
