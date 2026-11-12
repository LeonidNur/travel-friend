'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ApiError, type BackendApiClient, type TripProposalResponse, type TripProposalSummaryResponse } from '@/lib/backend-api-client';
import { formatProposalValue } from '@/lib/trip-inline-editing';
import { getProposalBlockedReasonLabel, getProposalStatusLabel } from '@/lib/trip-proposal-runtime';

type Props = Readonly<{
  token: string;
  userId: string;
  tripId: string;
  participantLabel: (userId: string) => string;
  api: Pick<BackendApiClient, 'getTripProposals' | 'getTripProposal' | 'voteTripProposal' | 'cancelTripProposal'>;
  onAccepted: () => void;
  onProposalsChange?: (proposals: TripProposalSummaryResponse[]) => void;
  externallyKnownProposals?: readonly TripProposalSummaryResponse[];
  reloadSignal?: number;
  children: (renderProposalAtScope: (scope: string) => ReactNode) => ReactNode;
}>;

const completedStatuses = new Set(['accepted', 'rejected', 'cancelled', 'expired', 'stale', 'needs_revision']);

export function TripProposalPanel({ token, userId, tripId, api, participantLabel, onAccepted, onProposalsChange, externallyKnownProposals = [], reloadSignal = 0, children }: Props) {
  const [proposals, setProposals] = useState<TripProposalSummaryResponse[]>([]);
  const [details, setDetails] = useState<Record<string, TripProposalResponse>>({});
  const detailAttempts = useRef(new Set<string>());
  const [voteChoices, setVoteChoices] = useState<Record<string, 'accept' | 'reject'>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    detailAttempts.current.clear();
    try { setProposals(await api.getTripProposals(token, tripId)); }
    catch { setError('Не удалось загрузить предложения. Попробуйте ещё раз.'); }
    finally { setIsLoading(false); }
  }, [api, token, tripId]);

  useEffect(() => { void Promise.resolve().then(reload); }, [reload, reloadSignal]);
  useEffect(() => { onProposalsChange?.(proposals); }, [onProposalsChange, proposals]);

  const visibleProposals = useMemo(() => {
    const combined = [...proposals];
    for (const external of externallyKnownProposals) {
      const index = combined.findIndex((item) => item.id === external.id);
      if (index === -1) combined.push(external);
      else combined[index] = external;
    }
    return combined;
  }, [externallyKnownProposals, proposals]);

  useEffect(() => {
    const next = visibleProposals.find((proposal) =>
      (proposal.status === 'pending' || proposal.status === 'blocked' || completedStatuses.has(proposal.status)) &&
      details[proposal.id] === undefined && !detailAttempts.current.has(proposal.id));
    if (!next) return;
    detailAttempts.current.add(next.id);
    void api.getTripProposal(token, tripId, next.id).then((detail) => {
      setDetails((current) => ({ ...current, [detail.id]: detail }));
    }).catch(() => {
      setError('Не удалось загрузить сравнение предложения. Нажмите «Обновить» и попробуйте ещё раз.');
    });
  }, [api, details, token, tripId, visibleProposals]);

  const vote = async (proposal: TripProposalSummaryResponse) => {
    const choice = voteChoices[proposal.id];
    if (!choice || saving) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await api.voteTripProposal(token, tripId, proposal.id, choice);
      setDetails((current) => ({ ...current, [updated.id]: updated }));
      setProposals((current) => current.map((item) => item.id === updated.id ? toSummary(updated) : item));
      setNotice(updated.status === 'accepted' ? 'Все участники приняли предложение. Подтверждённая поездка обновлена.' : 'Ваш голос сохранён. Изменить его нельзя.');
      if (updated.status === 'accepted') onAccepted();
    } catch (requestError) {
      setError(requestError instanceof ApiError && requestError.status === 409
        ? 'Состояние предложения изменилось. Обновите список и проверьте актуальный статус.'
        : 'Не удалось сохранить голос. Выбор остался на экране; можно повторить.');
    } finally { setSaving(false); }
  };

  const cancel = async (proposal: TripProposalSummaryResponse) => {
    setSaving(true); setError(null);
    try {
      const updated = await api.cancelTripProposal(token, tripId, proposal.id);
      setDetails((current) => ({ ...current, [updated.id]: updated }));
      setProposals((current) => current.map((item) => item.id === updated.id ? toSummary(updated) : item));
    } catch { setError('Не удалось отменить предложение. Обновите статус и повторите.'); }
    finally { setSaving(false); }
  };

  const renderProposalAtScope = (scope: string) => visibleProposals
    .filter((proposal) => !completedStatuses.has(proposal.status) && proposal.scopes.some((item) => scopesOverlap(item, scope)))
    .map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} detail={details[proposal.id]}
      scope={scope} participantLabel={participantLabel} voteChoice={voteChoices[proposal.id]}
      onVoteChoice={(choice) => setVoteChoices((current) => ({ ...current, [proposal.id]: choice }))}
      onVote={() => void vote(proposal)} onCancel={() => void cancel(proposal)} saving={saving} userId={userId} />);

  const completed = visibleProposals.filter((proposal) => completedStatuses.has(proposal.status));
  return <>
    {error ? <p role="alert" className="trip-draft-editor__message trip-draft-editor__message--error">{error}</p> : null}
    {notice ? <p role="status" className="trip-draft-editor__message">{notice}</p> : null}
    {isLoading ? <p className="surface-card__copy">Загружаем предложения…</p> : null}
    {children(renderProposalAtScope)}
    <details className="trip-proposal-history">
      <summary>История предложений{completed.length ? ` · ${completed.length}` : ''}</summary>
      <button className="profile-button profile-button--secondary" type="button" onClick={() => void reload()}>Обновить предложения</button>
      {completed.length === 0 ? <p className="surface-card__copy">Завершённых предложений пока нет.</p> : completed.map((proposal) => <ProposalCard key={proposal.id}
        proposal={proposal} detail={details[proposal.id]} participantLabel={participantLabel}
        saving={saving} userId={userId} />)}
    </details>
  </>;
}

function ProposalCard({ proposal, detail, scope, participantLabel, voteChoice, onVoteChoice, onVote, onCancel, saving, userId }: Readonly<{
  proposal: TripProposalSummaryResponse;
  detail?: TripProposalResponse;
  scope?: string;
  participantLabel: (userId: string) => string;
  voteChoice?: 'accept' | 'reject';
  onVoteChoice?: (choice: 'accept' | 'reject') => void;
  onVote?: () => void;
  onCancel?: () => void;
  saving: boolean;
  userId: string;
}>) {
  const operations = detail?.operations.filter((operation) => scope === undefined || operation.scope === scope || scopesOverlap(operation.scope, scope)) ?? [];
  return <article className="trip-proposal-card" id={`proposal-${proposal.id}`}>
    <h5>{proposal.title} · {getProposalStatusLabel(proposal.status)}</h5>
    <p className="surface-card__copy">Автор: {participantLabel(proposal.creator_user_id)}</p>
    {proposal.blocked_reason ? <p className="surface-card__copy">{getProposalBlockedReasonLabel(proposal.blocked_reason) ?? 'Ожидает выполнения условия.'}</p> : null}
    {operations.map((operation) => <div className="trip-proposal-card__diff" key={operation.scope}>
      <p><strong>Было:</strong> {formatProposalValue(operation.old_value)}</p>
      <p><strong>Предлагается:</strong> {formatProposalValue(operation.proposed_value)}</p>
    </div>)}
    {!detail ? <p className="surface-card__copy">Загружаем сравнение…</p> : null}
    <ul>{proposal.voters.map((voter) => <li key={voter.user_id}>{participantLabel(voter.user_id)}{voter.user_id === proposal.creator_user_id ? ' (автор)' : ''}: {voter.vote === 'accept' ? 'принял' : voter.vote === 'reject' ? 'отклонил' : 'ожидается голос'}</li>)}</ul>
    {proposal.status === 'pending' && proposal.own_vote === null && onVoteChoice && onVote ? <div className="trip-proposal-card__actions">
      <label><input type="radio" name={`vote-${proposal.id}`} checked={voteChoice === 'accept'} onChange={() => onVoteChoice('accept')} /> Принять</label>
      <label><input type="radio" name={`vote-${proposal.id}`} checked={voteChoice === 'reject'} onChange={() => onVoteChoice('reject')} /> Отклонить</label>
      <button className="profile-button profile-button--primary" type="button" disabled={!voteChoice || saving} onClick={onVote}>Проголосовать</button>
    </div> : null}
    {proposal.creator_user_id === userId && (proposal.status === 'pending' || proposal.status === 'blocked') && onCancel
      ? <button className="profile-button profile-button--secondary" type="button" disabled={saving} onClick={onCancel}>Отменить предложение</button> : null}
    {proposal.prerequisite_proposal_ids.length > 0 ? <p className="surface-card__copy">Связанные предложения: {proposal.prerequisite_proposal_ids.length}</p> : null}
  </article>;
}

function toSummary(proposal: TripProposalResponse): TripProposalSummaryResponse {
  const { operations, ...summary } = proposal;
  return { ...summary, scopes: operations.map((operation) => operation.scope) };
}

function scopesOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  if (left === 'itinerary:all') return right.startsWith('itinerary:day:') || right.startsWith('itinerary:event:');
  if (right === 'itinerary:all') return left.startsWith('itinerary:day:') || left.startsWith('itinerary:event:');
  const dayOf = (scope: string) => scope.startsWith('itinerary:day:') ? scope.slice('itinerary:day:'.length)
    : scope.startsWith('itinerary:event:') ? scope.split(':')[2] : null;
  const leftDay = dayOf(left);
  const rightDay = dayOf(right);
  return leftDay !== null && leftDay === rightDay && (left.startsWith('itinerary:event:') || right.startsWith('itinerary:event:'));
}
