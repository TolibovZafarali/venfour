const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatAdminDate(value: string | null) {
  if (!value) return "Not provided";
  const date = dateOnly(value);
  return date ? dateFormatter.format(date) : value;
}

export function formatAdminDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

export function formatAdminMileage(value: number | null) {
  return value === null
    ? "Not provided"
    : `${integerFormatter.format(value)} mi`;
}

export function formatAdminCurrency(value: number | null) {
  return value === null ? "Not provided" : currencyFormatter.format(value);
}

export function formatAdminFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) return `${kibibytes.toFixed(1)} KiB`;
  return `${(kibibytes / 1024).toFixed(1)} MiB`;
}

export function formatAdminAnswer(value: string | null) {
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  if (value === "not-sure") return "Not sure";
  return "Not provided";
}

export function formatAdminRepairStatus(value: string | null) {
  if (value === "complete") return "Repairs are complete";
  if (value === "in-progress") return "Repairs are in progress";
  if (value === "not-started") return "Repairs have not started";
  if (value === "not-sure") return "Not sure";
  return "Not provided";
}

export function formatAdminContactMethod(value: string | null) {
  if (value === "email") return "Email";
  if (value === "phone") return "Phone call";
  return "Not provided";
}

export function formatAdminVehicle(
  year: number | null,
  make: string | null,
  model: string | null,
) {
  const description = [year, make, model].filter(Boolean).join(" ");
  return description || "Not provided";
}

function dateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}
