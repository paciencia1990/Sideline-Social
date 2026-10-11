import type { SquadAdminMember } from '@/services/squadService';

export const SQUAD_ADMIN_MEMBER_PAGE_SIZE = 20;

function normalizeName(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function searchEligibleSquadMembers(members: SquadAdminMember[], query: string): SquadAdminMember[] {
  const words = normalizeName(query).split(' ').filter(Boolean);
  // Search public display names only. Account IDs and private contact details are not search fields.
  return words.length ? members.filter((member) => {
    const name = normalizeName(member.displayName ?? '');
    return words.every((word) => name.includes(word));
  }) : members;
}
