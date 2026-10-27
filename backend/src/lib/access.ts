import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import { type HomeRole, homeMembers, homes, type MemberPermissions } from '../db/schema';
import { forbidden, notFound, unauthorized } from './errors';

const rank: Record<HomeRole, number> = { member: 1, admin: 2, owner: 3 };

export function hasRole(role: HomeRole, min: HomeRole): boolean {
  return rank[role] >= rank[min];
}

export interface HomeAccess {
  role: HomeRole;
  permissions: MemberPermissions;
}

/**
 * Ensure the signed-in user belongs to the home with at least `min` role.
 * Non-members get 404 (don't reveal that the home exists); insufficient role gets 403.
 */
export async function requireHomeRole(
  ctx: AppContext,
  req: FastifyRequest,
  homeId: string,
  min: HomeRole = 'member',
): Promise<HomeAccess> {
  const userId = req.auth?.userId;
  if (!userId) throw unauthorized();
  const [row] = await ctx.db
    .select({ role: homeMembers.role, permissions: homes.memberPermissions })
    .from(homeMembers)
    .innerJoin(homes, eq(homes.id, homeMembers.homeId))
    .where(and(eq(homeMembers.homeId, homeId), eq(homeMembers.userId, userId)))
    .limit(1);
  if (!row) throw notFound('Home');
  if (!hasRole(row.role, min)) throw forbidden();
  return row;
}

/** Plain members need the home's permission for this area; admins/owners always pass. */
export function requireMemberPermission(access: HomeAccess, area: keyof MemberPermissions): void {
  if (access.role === 'member' && !access.permissions[area]) {
    throw forbidden('The home owner has not given members access to this');
  }
}

export function requireUser(req: FastifyRequest): string {
  const id = req.auth?.userId;
  if (!id) throw unauthorized();
  return id;
}
