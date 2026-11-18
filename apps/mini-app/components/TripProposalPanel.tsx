'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ApiError, type BackendApiClient, type TripProposalResponse, type TripProposalSummaryResponse } from '@/lib/backend-api-client';
import { formatTripBudget } from '@/lib/trip-detail-runtime';
import { formatProposalValue } from '@/lib/trip-inline-editing';
import { getProposalBlockedReasonLabel, getProposalStatusLabel } from '@/lib/trip-proposal-runtime';
import { shouldRenderProposalAtScope } from '@/lib/trip-proposal-placement';

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
  focusedProposalId?: string | null;
  onOpenProposal?: (id: string) => void;
  onCloseProposal?: () => void;
  onOpenProgram?: () => void;
  onOpenHistory?: () => void;
  confirmedContext?: (proposal: TripProposalSummaryResponse) => ReactNode;
  onReturnToEdit?: (proposal: TripProposalSummaryResponse) => void;
  children: (renderProposalAtScope: (scope: string) => ReactNode, proposalHistory: ReactNode) => ReactNode;
}>;

type ProposalError = Readonly<{ message: string; kind: 'detail' | 'conflict' | 'action' | 'vote' }>;

const completedStatuses = new Set(['accepted', 'rejected', 'cancelled', 'expired', 'stale', 'needs_revision']);

export function TripProposalPanel({ token, userId, tripId, api, participantLabel, onAccepted, onProposalsChange,
  externallyKnownProposals = [], reloadSignal = 0, focusedProposalId, onOpenProposal, onCloseProposal,
  onOpenProgram, onOpenHistory, confirmedContext, onReturnToEdit, children }: Props) {
  const [proposals, setProposals] = useState<TripProposalSummaryResponse[]>([]);
  const [details, setDetails] = useState<Record<string, TripProposalResponse>>({});
  const detailAttempts = useRef(new Set<string>());
  const loadGeneration = useRef(0);
  const [voteChoices, setVoteChoices] = useState<Record<string, 'accept' | 'reject'>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [proposalErrors, setProposalErrors] = useState<Readonly<Record<string, ProposalError | undefined>>>({});

  const setProposalError = useCallback((id: string, nextError?: ProposalError) => {
    setProposalErrors((current) => ({ ...current, [id]: nextError }));
  }, []);

  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setIsLoading(true);
    setError(null);
    try {
      const latest = await api.getTripProposals(token, tripId);
      if (generation !== loadGeneration.current) return;
      detailAttempts.current.clear();
      setDetails({});
      setProposals(latest);
      setProposalErrors({});
      return latest;
    } catch {
      if (generation !== loadGeneration.current) return;
      detailAttempts.current.clear();
      setError('Не удалось загрузить предложения. Попробуйте ещё раз.');
    } finally {
      if (generation === loadGeneration.current) setIsLoading(false);
    }
  }, [api, token, tripId]);

  useEffect(() => { void Promise.resolve().then(reload); }, [reload, reloadSignal]);
  useEffect(() => { onProposalsChange?.(proposals); }, [onProposalsChange, proposals]);

  const visibleProposals = useMemo(() => {
    const combined = [...proposals];
    for (const external of externallyKnownProposals) {
      const index = combined.findIndex((item) => item.id === external.id);
      if (index === -1) combined.push(external);
    }
    return combined;
  }, [externallyKnownProposals, proposals]);

  useEffect(() => {
    if (isLoading) return;
    const canFetch = (id: string) => details[id] === undefined && !detailAttempts.current.has(id);
    const id = onOpenProposal ? focusedProposalId : visibleProposals.find((proposal) => canFetch(proposal.id))?.id;
    if (!id || !canFetch(id)) return;
    const generation = loadGeneration.current;
    detailAttempts.current.add(id);
    void api.getTripProposal(token, tripId, id).then((detail) => {
      if (generation !== loadGeneration.current) return;
      setDetails((current) => ({ ...current, [detail.id]: detail }));
      if (onOpenProposal) setProposals((current) => upsertSummary(current, detail));
    }).catch(() => {
      if (generation !== loadGeneration.current) return;
      setProposalError(id, { message: 'Не удалось загрузить сравнение предложения. Обновите предложение и попробуйте ещё раз.', kind: 'detail' });
    });
  }, [api, details, token, tripId, visibleProposals, focusedProposalId, isLoading, onOpenProposal, setProposalError]);

  const vote = useCallback(async (proposal: TripProposalSummaryResponse) => {
    const choice = voteChoices[proposal.id];
    if (!choice || saving || proposalErrors[proposal.id]?.kind === 'conflict' || proposal.status !== 'pending' || proposal.own_vote !== null) return;
    setSaving(true); setProposalError(proposal.id); setNotice(null);
    try {
      const updated = await api.voteTripProposal(token, tripId, proposal.id, choice);
      setDetails((current) => ({ ...current, [updated.id]: updated }));
      setProposals((current) => upsertSummary(current, updated));
      if (updated.status === 'accepted') {
        setNotice('Все участники приняли предложение. Подтверждённая поездка обновлена.');
      } else {
        setNotice('Ваш голос сохранён. Изменить его нельзя.');
      }
      if (updated.status === 'accepted') onAccepted();
    } catch (requestError) {
      const conflict = requestError instanceof ApiError && requestError.status === 409;
      setProposalError(proposal.id, conflict
        ? { message: 'Состояние предложения изменилось. Обновите список и проверьте актуальный статус.', kind: 'conflict' }
        : { message: 'Не удалось сохранить голос. Выбор остался на экране; можно повторить.', kind: 'vote' });
    } finally { setSaving(false); }
  }, [api, onAccepted, proposalErrors, saving, setProposalError, token, tripId, voteChoices]);

  const cancel = useCallback(async (proposal: TripProposalSummaryResponse) => {
    if (saving) return;
    setSaving(true); setProposalError(proposal.id); setNotice(null);
    try {
      const updated = await api.cancelTripProposal(token, tripId, proposal.id);
      setDetails((current) => ({ ...current, [updated.id]: updated }));
      setProposals((current) => upsertSummary(current, updated));
    } catch (requestError) {
      setProposalError(proposal.id, { message: 'Не удалось отменить предложение. Обновите статус и повторите.',
        kind: requestError instanceof ApiError && requestError.status === 409 ? 'conflict' : 'action' });
    }
    finally { setSaving(false); }
  }, [api, saving, setProposalError, token, tripId]);

  const renderProposalAtScope = (scope: string) => visibleProposals
    .filter((proposal) => !completedStatuses.has(proposal.status) && shouldRenderProposalAtScope(proposal.scopes, scope))
    .map((proposal) => onOpenProposal ? <ProposalLink key={proposal.id} proposal={proposal} participantLabel={participantLabel} onOpen={onOpenProposal} /> : <ProposalCard key={proposal.id} proposal={proposal} detail={details[proposal.id]}
      participantLabel={participantLabel} voteChoice={voteChoices[proposal.id]}
      onVoteChoice={(choice) => setVoteChoices((current) => ({ ...current, [proposal.id]: choice }))}
      onVote={() => void vote(proposal)} onCancel={() => void cancel(proposal)} saving={saving} userId={userId} />);

  const completed = visibleProposals.filter((proposal) => completedStatuses.has(proposal.status));
  const focused = visibleProposals.find((proposal) => proposal.id === focusedProposalId);
  if (onOpenProposal) {
    const focusedRequestError = focusedProposalId ? proposalErrors[focusedProposalId] : undefined;
    const focusedError = focusedRequestError?.message ?? error;
    const reloadFocusedProposal = async () => {
      const latest = await reload();
      if (focused && focused.status !== 'accepted' && latest?.some((proposal) => proposal.id === focused.id && proposal.status === 'accepted')) {
        onAccepted();
      }
    };
    const history = <section className="trip-vote-history" aria-label="Предложения по поездке">
      {isLoading ? <p role="status">Загружаем предложения…</p> : null}
      {error && !focusedProposalId ? <p role="alert">{error}</p> : null}
      {visibleProposals.length === 0 && !isLoading ? <p>Предложений пока нет.</p> : null}
      {visibleProposals.filter((proposal) => !completedStatuses.has(proposal.status)).map((item) => <ProposalLink key={item.id} proposal={item} participantLabel={participantLabel} onOpen={onOpenProposal} />)}
      {completed.map((item, index) => <ProposalLink key={item.id} proposal={item}
        heading={index === 0 ? `Завершённые · ${completed.length}` : undefined}
        participantLabel={participantLabel} onOpen={onOpenProposal} />)}
      <button className="trip-vote-screen__back" type="button" disabled={isLoading || saving} onClick={() => void reload()}>Обновить предложения</button>
    </section>;
    return <>
      <div hidden={Boolean(focusedProposalId)}>{children(renderProposalAtScope, history)}</div>
      {focusedProposalId && focused ? <TripProposalView proposal={focused} detail={details[focused.id]}
        participantLabel={participantLabel} userId={userId} confirmed={confirmedContext?.(focused)}
        voteChoice={voteChoices[focused.id]} error={focusedError} saving={saving} refreshing={isLoading} voteConflict={focusedRequestError?.kind === 'conflict'}
        comparisonUnavailable={focusedRequestError?.kind === 'detail'} voteError={focusedRequestError?.kind === 'vote'}
        onVoteChoice={(choice) => setVoteChoices((current) => ({ ...current, [focused.id]: choice }))}
        onVote={details[focused.id] ? () => void vote(focused) : undefined} onCancel={() => void cancel(focused)}
        onReload={() => void reloadFocusedProposal()} onClose={onCloseProposal} onOpenProgram={onOpenProgram} onOpenHistory={onOpenHistory}
        onReturnToEdit={onReturnToEdit ? () => onReturnToEdit(focused) : undefined} /> : null}
      {focusedProposalId && !focused ? <section className="trip-vote-screen" aria-label="Предложение">
        {focusedError ? <p role="alert">{focusedError}</p> : <p role="status">Загружаем предложение…</p>}
        {focusedError ? <button className="profile-button profile-button--primary" type="button" disabled={isLoading} onClick={() => void reload()}>Обновить предложение</button> : null}
        {onCloseProposal ? <button className="profile-button profile-button--secondary" type="button" onClick={onCloseProposal}>Назад</button> : null}
      </section> : null}
    </>;
  }
  const inlineError = error ?? Object.values(proposalErrors).find((item) => item !== undefined)?.message;
  return <>
    {inlineError ? <p role="alert" className="trip-draft-editor__message trip-draft-editor__message--error">{inlineError}</p> : null}
    {notice ? <p role="status" className="trip-draft-editor__message">{notice}</p> : null}
    {isLoading ? <p className="surface-card__copy">Загружаем предложения…</p> : null}
    {children(renderProposalAtScope, null)}
    <details className="trip-proposal-history">
      <summary>История предложений{completed.length ? ` · ${completed.length}` : ''}</summary>
      <button className="profile-button profile-button--secondary" type="button" onClick={() => void reload()}>Обновить предложения</button>
      {completed.length === 0 ? <p className="surface-card__copy">Завершённых предложений пока нет.</p> : completed.map((proposal) => <ProposalCard key={proposal.id}
        proposal={proposal} detail={details[proposal.id]} participantLabel={participantLabel}
        saving={saving} userId={userId} />)}
    </details>
  </>;
}

type ProposalCardProps = Readonly<{
  proposal: TripProposalSummaryResponse;
  detail?: TripProposalResponse;
  participantLabel: (userId: string) => string;
  voteChoice?: 'accept' | 'reject';
  onVoteChoice?: (choice: 'accept' | 'reject') => void;
  onVote?: () => void;
  onCancel?: () => void;
  saving?: boolean;
  userId: string;
}>;

type ProposalViewProps = ProposalCardProps & Readonly<{
  confirmed?: ReactNode;
  error?: string | null;
  refreshing?: boolean;
  voteConflict?: boolean;
  voteError?: boolean;
  comparisonUnavailable?: boolean;
  onReload?: () => void;
  onClose?: () => void;
  onOpenProgram?: () => void;
  onOpenHistory?: () => void;
  onReturnToEdit?: () => void;
}>;

export function TripProposalView({ confirmed, error, refreshing, voteConflict, voteError, comparisonUnavailable, onReload, onClose, onOpenProgram, onOpenHistory, onReturnToEdit, ...card }: ProposalViewProps) {
  const { proposal, voteChoice, saving, userId, participantLabel } = card;
  const isAuthor = proposal.creator_user_id === userId;
  const viewerIsVoter = isAuthor || proposal.voters.some((voter) => voter.user_id === userId);
  const canReturnToEdit = ['rejected', 'stale', 'needs_revision'].includes(proposal.status);
  return <section className="trip-vote-screen" aria-labelledby={`vote-heading-${proposal.id}`}>
    <h2 id={`vote-heading-${proposal.id}`}>{getProposalScopeLabel(proposal.scopes)} · предложение</h2>
    {viewerIsVoter ? <p className="trip-vote-screen__participant">Вы: {participantLabel(userId)}{isAuthor ? ' · автор' : ''}</p> : null}
    {confirmed}
    <ProposalCard {...card} focused refreshing={refreshing} comparisonUnavailable={comparisonUnavailable}
      hideVoting={voteConflict} hideResult={voteConflict || voteError}
      onCancel={voteConflict ? undefined : card.onCancel}>
      {error ? <p role="alert" className="trip-vote-screen__error">{error}</p> : null}
    </ProposalCard>
    {onOpenProgram ? <button className="profile-button profile-button--secondary" type="button" onClick={onOpenProgram}>К программе</button> : null}
    {onReload && error && !voteError ? <button className="profile-button profile-button--primary" type="button" disabled={refreshing || saving} onClick={onReload}>Обновить предложение</button> : null}
    {voteConflict && voteChoice ? <p className="trip-vote-screen__participant">Выбранное решение: {voteChoice === 'accept' ? 'Принять' : 'Отклонить'}. Оно ещё не подтверждено сервером.</p> : null}
    {proposal.status === 'accepted' && onOpenHistory ? <button className="profile-button profile-button--secondary" type="button" onClick={onOpenHistory}>История предложений</button> : null}
    {canReturnToEdit && onReturnToEdit ? <button className="profile-button profile-button--secondary" type="button" onClick={onReturnToEdit}>{proposal.status === 'stale' ? 'Проверить текущий черновик' : 'Вернуться к правке'}</button> : null}
    {onClose && (proposal.status !== 'accepted' || !onOpenProgram || !onOpenHistory) ?
      <button className="trip-vote-screen__back" type="button" onClick={onClose}>Назад</button> : null}
  </section>;
}

function ProposalLink({ proposal, participantLabel, onOpen, heading }: Readonly<{
  proposal: TripProposalSummaryResponse;
  participantLabel: (userId: string) => string;
  onOpen: (id: string) => void;
  heading?: string;
}>) {
  return <article className="trip-vote-link">
    {heading ? <h3 className="trip-vote-history__heading">{heading}</h3> : null}
    <p><strong>{proposal.title}</strong>{completedStatuses.has(proposal.status) ? ` · ${getProposalStatusLabel(proposal.status).toLocaleLowerCase('ru-RU')}` : ''}</p>
    <p>{completedStatuses.has(proposal.status) ? getResultText(proposal, '', participantLabel) : `${getProposalStatusLabel(proposal.status)} · ${participantLabel(proposal.creator_user_id)}`}</p>
    <button className="profile-button profile-button--secondary" type="button" onClick={() => onOpen(proposal.id)}>Открыть предложение</button>
  </article>;
}

function getProposalScopeLabel(scopes: readonly string[]): string {
  if (scopes.length !== 1) return 'Поездка';
  const [scope] = scopes;
  const labels: Record<string, string> = { route: 'Маршрут', dates: 'Даты', budget: 'Бюджет', accommodation: 'Проживание', transport: 'Транспорт', 'itinerary:all': 'Программа' };
  if (scope.startsWith('itinerary:day:')) return 'День программы';
  if (scope.startsWith('itinerary:event:')) return 'Событие';
  return labels[scope] ?? 'Поездка';
}

function displayBudgetAmount(amount: unknown): string | null {
  if (typeof amount !== 'number' && !(typeof amount === 'string' && amount.trim())) return null;
  return Number.isFinite(Number(amount)) ? String(amount) : null;
}

function formatProposalComparison(scope: string, value: unknown): string {
  if (scope !== 'budget') return formatProposalValue(value);
  const budget = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return formatTripBudget({
    min: displayBudgetAmount(budget.min),
    max: displayBudgetAmount(budget.max),
    currency: typeof budget.currency === 'string' ? budget.currency : null,
    scope: budget.scope === 'per_person' || budget.scope === 'group_total' ? budget.scope : null
  }) ?? 'От: не указано · до: не указано\nВалюта: не указана · на: не указано';
}

function getResultText(proposal: TripProposalSummaryResponse, userId: string, participantLabel: (id: string) => string) {
  switch (proposal.status) {
    case 'accepted': return 'Все участники приняли. Согласованный план обновлён.';
    case 'rejected': return 'Один участник отклонил. Согласованный план не изменился.';
    case 'cancelled': return 'Автор отменил предложение. План не изменился.';
    case 'expired': return 'Срок голосования истёк. План не изменился.';
    case 'stale': return 'Данные этой части поездки изменились. Подготовьте новое предложение.';
    case 'needs_revision': return 'Связанное предложение не принято. Проверьте изменение перед повторной отправкой.';
    case 'blocked': return null;
    case 'pending': {
      const accepted = proposal.voters.filter((voter) => voter.vote === 'accept').length;
      const waiting = proposal.voters.filter((voter) => voter.vote === null);
      if (waiting.length === 1 && accepted > 0) {
        const pendingUserId = waiting[0].user_id;
        if (pendingUserId === userId) return 'Остался ваш голос. Согласованный план пока не изменён.';
        return `Приняли ${accepted} из ${proposal.voters.length}. Ожидаем голос: ${participantLabel(pendingUserId)}. Согласованный план пока не изменён.`;
      }
      return accepted > 0 ? `Приняли ${accepted} из ${proposal.voters.length}. Согласованный план пока не изменён.` : 'Никто ещё не проголосовал. План не изменён.';
    }
  }
}

function ProposalCard({ proposal, detail, participantLabel, voteChoice, onVoteChoice, onVote, onCancel, saving, userId, focused = false, refreshing, comparisonUnavailable, hideVoting, hideResult, children }: ProposalCardProps & Readonly<{
  focused?: boolean; refreshing?: boolean; comparisonUnavailable?: boolean; hideVoting?: boolean; hideResult?: boolean; children?: ReactNode;
}>) {
  const operations = detail?.operations ?? [];
  const formatComparison = focused ? formatProposalComparison : (_scope: string, value: unknown) => formatProposalValue(value);
  const voting = !hideVoting && proposal.status === 'pending' && proposal.own_vote === null && (!focused || proposal.voters.some((voter) => voter.user_id === userId));
  const result = focused && !hideResult ? getResultText(proposal, userId, participantLabel) : null;
  return <article className="trip-proposal-card" id={`proposal-${proposal.id}`}>
    {focused ? <><h3>{proposal.title}</h3><p>{getProposalStatusLabel(proposal.status)}</p></> : <h5>{proposal.title} · {getProposalStatusLabel(proposal.status)}</h5>}
    <p className="surface-card__copy">Автор: {participantLabel(proposal.creator_user_id)}</p>
    {proposal.blocked_reason ? <p className="surface-card__copy">{getProposalBlockedReasonLabel(proposal.blocked_reason) ?? 'Ожидает выполнения условия.'}</p> : null}
    {operations.map((operation) => <div className="trip-proposal-card__diff" key={operation.scope}>
      {focused && operations.length > 1 ? <h4>{getProposalScopeLabel([operation.scope])}</h4> : null}
      <p><strong>{focused ? 'Было' : 'Было:'}</strong>{' '}{formatComparison(operation.scope, operation.old_value)}</p>
      <p><strong>{focused ? 'Предлагается' : 'Предлагается:'}</strong>{' '}{formatComparison(operation.scope, operation.proposed_value)}</p>
    </div>)}
    {!detail && !comparisonUnavailable ? <p className="surface-card__copy" role="status">Загружаем сравнение…</p> : null}
    <ul>{proposal.voters.map((voter) => <li key={voter.user_id}>{participantLabel(voter.user_id)}{voter.user_id === proposal.creator_user_id ? ' (автор)' : ''}: {voter.vote === 'accept' ? 'принял' : voter.vote === 'reject' ? 'отклонил' : 'ожидается голос'}</li>)}</ul>
    {result ? <p role="status">{result}</p> : null}
    {children}
    {voting && (focused || (onVoteChoice && onVote)) ? <div className="trip-proposal-card__actions" role="group" aria-label="Решение по предложению">
      <label><input type="radio" name={`vote-${proposal.id}`} checked={voteChoice === 'accept'} disabled={saving || refreshing || !onVoteChoice} onChange={() => onVoteChoice?.('accept')} /> Принять</label>
      <label><input type="radio" name={`vote-${proposal.id}`} checked={voteChoice === 'reject'} disabled={saving || refreshing || !onVoteChoice} onChange={() => onVoteChoice?.('reject')} /> Отклонить</label>
      <button className="profile-button profile-button--primary" type="button" disabled={!voteChoice || saving || refreshing || !onVote} onClick={onVote}>{focused && saving ? 'Отправляем голос…' : 'Проголосовать'}</button>
      {focused ? <p>{voteChoice ? 'Решение выбрано. Голос ещё не отправлен.' : 'Выберите решение, затем отправьте голос.'}</p> : null}
    </div> : null}
    {focused && proposal.status === 'pending' && proposal.own_vote !== null ? <>
      <button className="profile-button profile-button--primary" type="button" disabled>Ваш голос сохранён</button>
      <p>Изменить отправленный голос нельзя.</p>
    </> : null}
    {proposal.creator_user_id === userId && (proposal.status === 'pending' || proposal.status === 'blocked') && onCancel
      ? <button className="profile-button profile-button--secondary" type="button" disabled={saving || refreshing} onClick={onCancel}>Отменить предложение</button> : null}
    {proposal.prerequisite_proposal_ids.length > 0 ? <p className="surface-card__copy">Связанные предложения: {proposal.prerequisite_proposal_ids.length}</p> : null}
  </article>;
}

function upsertSummary(current: TripProposalSummaryResponse[], proposal: TripProposalResponse) {
  const item = toSummary(proposal);
  return current.some((entry) => entry.id === item.id)
    ? current.map((entry) => entry.id === item.id ? item : entry)
    : [...current, item];
}

function toSummary(proposal: TripProposalResponse): TripProposalSummaryResponse {
  const { operations, ...summary } = proposal;
  return { ...summary, scopes: operations.map((operation) => operation.scope) };
}
