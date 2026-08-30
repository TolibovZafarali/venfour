export function maskedClaimEmail(email: string) {
  const [local, domain] = email.split("@");
  return domain ? `${local.slice(0, 2)}••••@${domain}` : "Your saved email";
}

