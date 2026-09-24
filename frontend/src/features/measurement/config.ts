export function googleConfiguration(id = import.meta.env.VITE_GOOGLE_ADS_CONVERSION_ID, label = import.meta.env.VITE_GOOGLE_ADS_PURCHASE_LABEL) {
  if (!id || !/^AW-[0-9]{5,20}$/.test(id) || !label || !/^[A-Za-z0-9_-]{1,128}$/.test(label)) return null;
  return { id, label, enhanced: import.meta.env.VITE_GOOGLE_ENHANCED_CONVERSIONS === "true" };
}
