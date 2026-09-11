export const DEFAULT_STAFF_ROLE_ID = "1477246087436963931";

export function getStaffRoleId(override?: string): string {
  return override?.trim() || DEFAULT_STAFF_ROLE_ID;
}
