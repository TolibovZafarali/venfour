export const loadStripe = async () => ({});
export function useCheckoutElements() { return { type: "success", checkout: { confirm: async () => ({ type: "error", error: { message: "This is a visual payment fixture. No payment can be submitted." } }) } }; }
