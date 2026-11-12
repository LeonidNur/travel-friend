'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError, type BackendApiClient, type TripDraftContent, type TripItineraryDayResponse, type TripProposalResponse, type TripProposalSummaryResponse } from '@/lib/backend-api-client';
import { getProposalStatusLabel } from '@/lib/trip-proposal-runtime';

type Props = Readonly<{
  token: string;
  userId: string;
  tripId: string;
  draftVersion: number;
  draftContent: TripDraftContent;
  savedContent: TripDraftContent;
  confirmedDays: readonly TripItineraryDayResponse[];
  participantLabel: (userId: string) => string;
  api: Pick<BackendApiClient, 'getTripProposals' | 'getTripProposal' | 'createTripProposal' | 'voteTripProposal' | 'cancelTripProposal'>;
  onAccepted: () => void;
  onProposalsChange?: (proposals: TripProposalSummaryResponse[]) => void;
  enableCreate?: boolean;
  reloadSignal?: number;
}>;

const scopeLabels: Readonly<Record<string, string>> = {
  route: 'Маршрут', dates: 'Даты', budget: 'Бюджет', transport: 'Транспорт',
  accommodation: 'Проживание', 'itinerary:all': 'Вся программа'
};

export function TripProposalPanel({ token, userId, tripId, draftVersion, draftContent, savedContent, confirmedDays, api, participantLabel, onAccepted, onProposalsChange, enableCreate = true, reloadSignal = 0 }: Props) {
  const [proposals, setProposals] = useState<TripProposalSummaryResponse[]>([]);
  const [details, setDetails] = useState<Record<string, TripProposalResponse>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [voteChoices, setVoteChoices] = useState<Record<string, 'accept' | 'reject'>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setProposals(await api.getTripProposals(token, tripId));
    } catch {
      setError('Не удалось загрузить предложения. Попробуйте ещё раз.');
    } finally {
      setIsLoading(false);
    }
  }, [api, token, tripId]);

  useEffect(() => { void Promise.resolve().then(reload); }, [reload, reloadSignal]);
  useEffect(() => { onProposalsChange?.(proposals); }, [onProposalsChange, proposals]);

  const toggleScope = (scope: string) => {
    setSelectedScopes((current) => {
      if (current.includes(scope)) return current.filter((item) => item !== scope);
      if (current.some((item) => scopesOverlap(item, scope))) {
        setError('Нельзя объединить пересекающиеся области. Отправьте их отдельными предложениями.');
        return current;
      }
      setError(null);
      return [...current, scope];
    });
  };

  const create = async () => {
    if (selectedScopes.length === 0 || !title.trim() || saving) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const proposal = await api.createTripProposal(token, tripId, {
        draft_version: draftVersion, title: title.trim(), idempotency_key: crypto.randomUUID(),
        scopes: selectedScopes
      });
      setDetails((current) => ({ ...current, [proposal.id]: proposal }));
      setProposals((current) => [toSummary(proposal), ...current.filter((item) => item.id !== proposal.id)]);
      setTitle(''); setSelectedScopes([]);
      setNotice('Предложение сохранено как отдельный снимок. Черновик можно редактировать дальше.');
    } catch (requestError) {
      setError(requestError instanceof ApiError && requestError.status === 409
        ? 'Черновик или выбранная область уже изменились. Обновите поездку и повторите.'
        : 'Не удалось отправить предложение. Выбранные изменения остались в черновике.');
    } finally { setSaving(false); }
  };

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
    } catch {
      setError('Не удалось отменить предложение. Обновите статус и повторите.');
    } finally { setSaving(false); }
  };

  const openDetails = async (proposal: TripProposalSummaryResponse) => {
    if (details[proposal.id] || detailLoadingId) return;
    setDetailLoadingId(proposal.id); setError(null);
    try {
      const detail = await api.getTripProposal(token, tripId, proposal.id);
      setDetails((current) => ({ ...current, [detail.id]: detail }));
    } catch {
      setError('Не удалось открыть изменения предложения. Попробуйте ещё раз.');
    } finally { setDetailLoadingId(null); }
  };

  const isDraftSaved = JSON.stringify(draftContent) === JSON.stringify(savedContent);
  return (
    <section className="trip-draft-editor" aria-labelledby="trip-proposals-title">
      <header className="trip-draft-editor__header"><div>
        <p className="section-kicker">Обсуждение изменений</p><h3 id="trip-proposals-title">Предложения поездки</h3>
        <p className="surface-card__copy">Подтверждённая поездка изменится только после единогласного принятия.</p>
      </div><button className="profile-button profile-button--secondary" type="button" onClick={() => void reload()}>Обновить</button></header>
      {error ? <p role="alert" className="trip-draft-editor__message trip-draft-editor__message--error">{error}</p> : null}
      {notice ? <p role="status" className="trip-draft-editor__message">{notice}</p> : null}
      {enableCreate ? <fieldset className="trip-draft-editor__fields" disabled={saving}>
        <DraftCheckbox label={scopeLabels.route} checked={selectedScopes.includes('route')} onChange={() => toggleScope('route')} />
        <DraftCheckbox label={scopeLabels.dates} checked={selectedScopes.includes('dates')} onChange={() => toggleScope('dates')} />
        <DraftCheckbox label={scopeLabels.budget} checked={selectedScopes.includes('budget')} onChange={() => toggleScope('budget')} />
        <DraftCheckbox label={scopeLabels.transport} checked={selectedScopes.includes('transport')} onChange={() => toggleScope('transport')} />
        <DraftCheckbox label={scopeLabels.accommodation} checked={selectedScopes.includes('accommodation')} onChange={() => toggleScope('accommodation')} />
        <DraftCheckbox label={scopeLabels['itinerary:all']} checked={selectedScopes.includes('itinerary:all')} onChange={() => toggleScope('itinerary:all')} />
        {proposalDays(draftContent, confirmedDays).map(({ id, title: dayTitle, events, draftDay, confirmedDay }) => <div key={id}>
          {draftDay ? <DraftCheckbox label={`День: ${dayTitle || 'без названия'}`} checked={selectedScopes.includes(`itinerary:day:${id}`)} onChange={() => toggleScope(`itinerary:day:${id}`)} /> : null}
          {events.map((event) => {
            const scope = `itinerary:event:${id}:${event.id}`;
            return <DraftCheckbox key={scope} label={`  Событие: ${event.title || 'без названия'}`} checked={selectedScopes.includes(scope)} disabled={!confirmedDay} onChange={() => toggleScope(scope)} />;
          })}
          {!confirmedDay && events.length > 0 ? <p className="surface-card__copy">Сначала согласуйте день, чтобы предложить изменение отдельного события.</p> : null}
        </div>)}
        <label className="trip-draft-editor__field"><span>Краткое название</span><input className="profile-input" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        {!isDraftSaved ? <p className="trip-draft-editor__message">Сначала сохраните черновик. Proposal снимет только выбранные области сохранённой версии.</p> : null}
        <button className="profile-button profile-button--primary" type="button" disabled={!isDraftSaved || !title.trim() || selectedScopes.length === 0} onClick={() => void create()}>{saving ? 'Сохраняем…' : 'Предложить участникам'}</button>
      </fieldset> : null}
      {isLoading ? <p className="surface-card__copy">Загружаем предложения…</p> : null}
      {!isLoading && proposals.length === 0 ? <p className="surface-card__copy">Предложений пока нет.</p> : null}
      {proposals.map((proposal) => (
        <article className="trip-draft-editor__day" id={`proposal-${proposal.id}`} key={proposal.id}>
          <h4>{proposal.title} · {getProposalStatusLabel(proposal.status)}</h4>
          <p className="surface-card__copy">Автор: {participantLabel(proposal.creator_user_id)}</p>
          <p className="surface-card__copy">Области: {proposal.scopes.map((scope) => scopeLabel(scope, draftContent, confirmedDays)).join(', ')}</p>
          {proposal.blocked_reason ? <p className="surface-card__copy">Причина ожидания: {proposal.blocked_reason === 'scope_busy' ? 'область занята другим голосованием' : 'сначала должно завершиться связанное предложение'}.</p> : null}
          {!details[proposal.id] ? <button className="profile-button profile-button--secondary" type="button" disabled={detailLoadingId !== null} onClick={() => void openDetails(proposal)}>{detailLoadingId === proposal.id ? 'Загружаем…' : 'Показать изменения'}</button> : null}
          {(details[proposal.id]?.operations ?? []).map((operation) => <div key={operation.scope}>
            <p><strong>{scopeLabel(operation.scope, draftContent, confirmedDays)}: было → предлагается</strong></p>
            <pre className="trip-proposal-diff">{JSON.stringify(operation.old_value, null, 2)}{'\n→\n'}{JSON.stringify(operation.proposed_value, null, 2)}</pre>
          </div>)}
          <ul>{proposal.voters.map((voter) => <li key={voter.user_id}>{participantLabel(voter.user_id)}{voter.user_id === proposal.creator_user_id ? ' (автор)' : ''}: {voter.vote === 'accept' ? 'принял' : voter.vote === 'reject' ? 'отклонил' : 'ожидается голос'}</li>)}</ul>
          {proposal.status === 'pending' && proposal.own_vote === null ? <div>
            <label><input type="radio" name={`vote-${proposal.id}`} checked={voteChoices[proposal.id] === 'accept'} onChange={() => setVoteChoices((current) => ({ ...current, [proposal.id]: 'accept' }))} /> Принять</label>
            <label><input type="radio" name={`vote-${proposal.id}`} checked={voteChoices[proposal.id] === 'reject'} onChange={() => setVoteChoices((current) => ({ ...current, [proposal.id]: 'reject' }))} /> Отклонить</label>
            <button className="profile-button profile-button--primary" type="button" disabled={!voteChoices[proposal.id]} onClick={() => void vote(proposal)}>Проголосовать</button>
          </div> : null}
          {proposal.creator_user_id === userId && (proposal.status === 'pending' || proposal.status === 'blocked') ? <button className="profile-button profile-button--secondary" type="button" onClick={() => void cancel(proposal)}>Отменить предложение</button> : null}
          {proposal.prerequisite_proposal_ids.length > 0 ? <p className="surface-card__copy">Связанные предложения: {proposal.prerequisite_proposal_ids.length}</p> : null}
        </article>
      ))}
    </section>
  );
}

function toSummary(proposal: TripProposalResponse): TripProposalSummaryResponse {
  const { operations, ...summary } = proposal;
  return { ...summary, scopes: operations.map((operation) => operation.scope) };
}

function scopesOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  if (left === 'itinerary:all') return right.startsWith('itinerary:day:') || right.startsWith('itinerary:event:');
  if (right === 'itinerary:all') return left.startsWith('itinerary:day:') || left.startsWith('itinerary:event:');
  const dayOf = (scope: string) => scope.startsWith('itinerary:day:')
    ? scope.slice('itinerary:day:'.length)
    : scope.startsWith('itinerary:event:') ? scope.split(':')[2] : null;
  const leftDay = dayOf(left);
  const rightDay = dayOf(right);
  return leftDay !== null && leftDay === rightDay && (left.startsWith('itinerary:event:') || right.startsWith('itinerary:event:'));
}

function proposalDays(draft: TripDraftContent, confirmed: readonly TripItineraryDayResponse[]) {
  const days = new Map<string, { id: string; title: string | null; draftDay: boolean; confirmedDay: boolean; events: Map<string, { id: string; title: string }> }>();
  for (const day of confirmed) {
    const entry = { id: day.id, title: day.title, draftDay: false, confirmedDay: true, events: new Map<string, { id: string; title: string }>() };
    for (const event of day.events) entry.events.set(event.id, { id: event.id, title: event.title });
    days.set(day.id, entry);
  }
  for (const day of draft.days) {
    const entry = days.get(day.id) ?? { id: day.id, title: day.title, draftDay: true, confirmedDay: false, events: new Map<string, { id: string; title: string }>() };
    entry.title = day.title;
    entry.draftDay = true;
    for (const event of day.events) entry.events.set(event.id, { id: event.id, title: event.title });
    days.set(day.id, entry);
  }
  return [...days.values()].map((day) => ({
    id: day.id, title: day.title, draftDay: day.draftDay, confirmedDay: day.confirmedDay, events: [...day.events.values()]
  }));
}

function scopeLabel(scope: string, draft: TripDraftContent, confirmed: readonly TripItineraryDayResponse[]): string {
  if (scopeLabels[scope]) return scopeLabels[scope];
  if (scope.startsWith('itinerary:day:')) {
    const dayId = scope.slice('itinerary:day:'.length);
    const day = proposalDays(draft, confirmed).find((item) => item.id === dayId);
    return `День: ${day?.title || 'без названия'}`;
  }
  if (scope.startsWith('itinerary:event:')) {
    const [, , dayId, eventId] = scope.split(':');
    const day = proposalDays(draft, confirmed).find((item) => item.id === dayId);
    const event = day?.events.find((item) => item.id === eventId);
    return `Событие: ${event?.title || 'удалённое событие'}`;
  }
  return scope;
}

function DraftCheckbox({ label, checked, disabled = false, onChange }: Readonly<{ label: string; checked: boolean; disabled?: boolean; onChange: () => void }>) {
  return <label className="trip-draft-proposal-scope"><input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} /> {label}</label>;
}
