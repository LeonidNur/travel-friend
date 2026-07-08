import type { ChatStatus, MockChat } from '@/lib/types';

export const CHAT_STATUS_LABELS: Record<ChatStatus, string> = {
  match: 'Мэтч',
  interest_sent: 'Интерес отправлен',
  draft: 'Черновик обсуждения'
};

export const mockChats: MockChat[] = [
  {
    id: 'chat-amina-tbilisi',
    buddyName: 'Амина',
    age: 27,
    city: 'Казань',
    destination: 'Тбилиси',
    status: 'match',
    previewText: 'Можно начать с обсуждения дат, района для жилья и общего бюджета на поездку.',
    updatedLabel: 'только что'
  },
  {
    id: 'chat-ilya-istanbul',
    buddyName: 'Илья',
    age: 30,
    city: 'Москва',
    destination: 'Стамбул',
    status: 'interest_sent',
    previewText: 'Пока это заготовка: здесь позже будет удобно договориться о перелёте и планах на выходные.',
    updatedLabel: 'сегодня'
  },
  {
    id: 'chat-sonya-yerevan',
    buddyName: 'Соня',
    age: 25,
    city: 'Ереван',
    destination: 'Будапешт',
    status: 'draft',
    previewText: 'Черновик подсказывает тему для старта: бюджет, темп поездки и интерес к музеям или прогулкам.',
    updatedLabel: 'сегодня'
  },
  {
    id: 'chat-timur-baku',
    buddyName: 'Тимур',
    age: 32,
    city: 'Санкт-Петербург',
    destination: 'Баку',
    status: 'match',
    previewText: 'Есть взаимный интерес. Когда появится backend, здесь можно будет быстро сверить маршрут и даты.',
    updatedLabel: 'вчера'
  }
];
