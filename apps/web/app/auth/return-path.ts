export const AUTH_RETURN_PATHS = ["/", "/account", "/auth/update-password"] as const;
export type AuthReturnPath = (typeof AUTH_RETURN_PATHS)[number];

export function safeReturnPath(value: string | null): AuthReturnPath {
  return AUTH_RETURN_PATHS.find((path) => path === value) ?? "/account";
}
