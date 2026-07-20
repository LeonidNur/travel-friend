import type { BuddyProfile, InterestDecision } from './types';

export type InterestDecisions = Readonly<Partial<Record<string, InterestDecision>>>;
export type PositiveInterestDecision = Exclude<InterestDecision, 'rejected'>;
export type SelectedDiscoverBuddy = {
  buddy: BuddyProfile;
  decision: PositiveInterestDecision;
};

export function getPositiveInterestDecision(
  buddy: Pick<BuddyProfile, 'likedYou'>
): PositiveInterestDecision {
  return buddy.likedYou === true ? 'match' : 'interest-sent';
}

export function setInterestDecision(
  decisions: InterestDecisions,
  buddyId: string,
  decision: InterestDecision
): InterestDecisions {
  if (Object.hasOwn(decisions, buddyId)) {
    return decisions;
  }

  return { ...decisions, [buddyId]: decision };
}

export function getRemainingDiscoverCandidates(
  candidates: readonly BuddyProfile[],
  decisions: InterestDecisions
): BuddyProfile[] {
  return candidates.filter((buddy) => !Object.hasOwn(decisions, buddy.id));
}

export function getViewedDiscoverCount(
  candidates: readonly BuddyProfile[],
  decisions: InterestDecisions
): number {
  return candidates.filter((buddy) => Object.hasOwn(decisions, buddy.id)).length;
}

export function getSelectedDiscoverBuddies(
  candidates: readonly BuddyProfile[],
  decisions: InterestDecisions
): SelectedDiscoverBuddy[] {
  return candidates.flatMap((buddy) => {
    const decision = decisions[buddy.id];

    if (decision === 'match' || decision === 'interest-sent') {
      return [{ buddy, decision }];
    }

    return [];
  });
}
