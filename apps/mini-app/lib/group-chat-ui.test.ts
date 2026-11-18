import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, useState, type FormEvent } from 'react';
import { JSDOM } from 'jsdom';
import { GroupChatForm } from '../components/GroupChatForm';
import { validateGroupChatCompanionIds } from './group-chat-runtime';

test('group selection validates, preserves selection on error and retries', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent'] as const;
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as unknown as Record<string, unknown>)[key] });
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const { createRoot } = await import('react-dom/client'); const container = dom.window.document.getElementById('root'); assert.ok(container);
  const root = createRoot(container); let attempts = 0;
  function Harness() {
    const [selected, setSelected] = useState<string[]>([]); const [error, setError] = useState<string | null>(null); const [retry, setRetry] = useState(false);
    const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const validation = validateGroupChatCompanionIds(selected); if (validation) { setError(validation); return; } attempts += 1; setError('Ошибка сети'); setRetry(true); };
    return createElement(GroupChatForm, { companions: [{ user_id: '1', display_name: 'Анна' }, { user_id: '2', display_name: 'Иван' }], selectedIds: selected, title: '', error, isCreating: false, canRetry: retry, onTitleChange: () => undefined, onToggle: (id: string) => setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]), onSubmit: submit, onBack: () => undefined });
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    const submit = () => { const form = container.querySelector('form'); assert.ok(form); form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); };
    await act(async () => submit()); assert.match(container.textContent ?? '', /Выберите минимум двух/); assert.equal(attempts, 0);
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => { inputs[0].click(); inputs[1].click(); });
    await act(async () => submit()); assert.equal(attempts, 1); assert.match(container.textContent ?? '', /Ошибка сети/); assert.ok(inputs[0].checked && inputs[1].checked);
    await act(async () => submit()); assert.equal(attempts, 2); assert.ok(inputs[0].checked && inputs[1].checked);
  } finally { await act(async () => root.unmount()); dom.window.close(); for (const key of keys) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); }
});
