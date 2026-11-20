'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

type OnboardingStatusPanelProps = Readonly<{
  title: string;
  message: string;
  tone?: 'default' | 'error';
  children?: ReactNode;
}>;

export function OnboardingStatusPanel({ title, message, tone = 'default', children }: OnboardingStatusPanelProps) {
  const panel = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [title]);

  return (
    <section ref={panel} className={`onboarding-status${tone === 'error' ? ' onboarding-status--error' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <h2>{title}</h2>
      <p>{message}</p>
      {children}
    </section>
  );
}
