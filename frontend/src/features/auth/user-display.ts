import type { User } from "@supabase/supabase-js";

function metadataString(user: User, key: string) {
  const value = user.user_metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getUserFullName(user: User) {
  return (
    metadataString(user, "full_name") ??
    metadataString(user, "name") ??
    metadataString(user, "display_name")
  );
}

export function getUserAccountLabel(user: User) {
  const fullName = getUserFullName(user);
  return fullName?.split(/\s+/)[0] ?? user.email ?? "Account";
}

export function getUserIdentityLabel(user: User) {
  return user.email ?? getUserFullName(user) ?? "Signed-in account";
}
