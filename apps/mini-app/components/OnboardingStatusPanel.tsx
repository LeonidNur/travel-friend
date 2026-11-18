'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

type OnboardingStatusPanelProps = Readonly<{
  title: string;
  message: string;
  tone?: 'default' | 'error';
  detail?: string;
  children?: ReactNode;
}>;

export function OnboardingStatusPanel({ title, message, tone = 'default', detail, children }: OnboardingStatusPanelProps) {
  const panel = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [title]);

  return (
    <section ref={panel} className={`onboarding-status${tone === 'error' ? ' onboarding-status--error' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <h2>{title}</h2>
      <p>{message}</p>
      {children}
      {detail ? <p className="onboarding-status__detail">{detail}</p> : null}
    </section>
  );
}
