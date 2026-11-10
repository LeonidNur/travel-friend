import type { TripProposalStatus } from './backend-api-client';

const STATUS_LABELS: Readonly<Record<TripProposalStatus, string>> = {
  pending: 'На голосовании', blocked: 'Ожидает условия', accepted: 'Принято', rejected: 'Отклонено',
  cancelled: 'Отменено', expired: 'Срок голосования истёк', stale: 'Устарело', needs_revision: 'Требует пересмотра'
};

const EVENT_LABELS: Readonly<Record<string, string>> = {
  proposal_created: 'Создано предложение по поездке.',
  proposal_accepted: 'Предложение принято. Подтверждённая поездка обновлена.',
  proposal_rejected: 'Предложение отклонено.', proposal_cancelled: 'Предложение отменено автором.',
  proposal_expired: 'Срок голосования истёк.', proposal_stale: 'Данные поездки изменились; предложение устарело.',
  proposal_unblocked: 'Условие выполнено: голосование открыто.',
  proposal_needs_revision: 'Предложение требует пересмотра.'
};

export function getProposalStatusLabel(status: TripProposalStatus): string {
  return STATUS_LABELS[status];
}

export function getProposalBlockedReasonLabel(reason: string | null | undefined): string | null {
  if (reason === 'scope_busy') return 'Область занята другим голосованием.';
  if (reason === 'prerequisite_pending') return 'Ожидает завершения связанного предложения.';
  if (reason === 'prerequisite_not_accepted') return 'Связанное предложение не принято.';
  if (reason === 'scope_version_changed') return 'Данные этой области изменились.';
  if (reason === 'deadline_elapsed') return 'Срок голосования истёк.';
  return null;
}

export function getProposalEventLabel(event: string | null | undefined): string {
  return event === undefined || event === null ? 'Событие предложения по поездке.' : EVENT_LABELS[event] ?? 'Обновлено предложение по поездке.';
}
