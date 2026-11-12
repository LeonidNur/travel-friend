export function getProposalDisplayScope(scopes: readonly string[]): string | null {
  if (scopes.length === 0) return null;

  const itineraryScopes = scopes.filter((scope) => scope.startsWith('itinerary:'));
  if (itineraryScopes.length === 0) return scopes[0];
  if (itineraryScopes.length !== scopes.length) return scopes[0];
  if (itineraryScopes.includes('itinerary:all')) return 'itinerary:all';

  const dayIds = [...new Set(itineraryScopes.map(getDayId).filter((dayId): dayId is string => dayId !== null))];
  if (dayIds.length > 1) return 'itinerary:all';
  if (dayIds.length === 0) return itineraryScopes[0];

  const dayScope = `itinerary:day:${dayIds[0]}`;
  const eventScopes = itineraryScopes.filter((scope) => scope.startsWith('itinerary:event:'));
  if (itineraryScopes.includes(dayScope) || eventScopes.length !== 1) return dayScope;
  return eventScopes[0];
}

export function shouldRenderProposalAtScope(scopes: readonly string[], scope: string): boolean {
  return getProposalDisplayScope(scopes) === scope;
}

export function proposalScopesOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  if (left === 'itinerary:all') return right.startsWith('itinerary:day:') || right.startsWith('itinerary:event:');
  if (right === 'itinerary:all') return left.startsWith('itinerary:day:') || left.startsWith('itinerary:event:');

  const leftDayId = getDayId(left);
  const rightDayId = getDayId(right);
  return leftDayId !== null && leftDayId === rightDayId && (
    left.startsWith('itinerary:event:') || right.startsWith('itinerary:event:')
  );
}

function getDayId(scope: string): string | null {
  if (scope.startsWith('itinerary:day:')) return scope.slice('itinerary:day:'.length);
  return scope.startsWith('itinerary:event:') ? scope.split(':')[2] ?? null : null;
}
