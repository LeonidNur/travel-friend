type OnboardingStatusPanelProps = Readonly<{
  title: string;
  message: string;
  tone?: 'default' | 'error';
  detail?: string;
}>;

export function OnboardingStatusPanel({ title, message, tone = 'default', detail }: OnboardingStatusPanelProps) {
  return (
    <section className={`onboarding-status${tone === 'error' ? ' onboarding-status--error' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <h2>{title}</h2>
      <p>{message}</p>
      {detail ? <p className="onboarding-status__detail">{detail}</p> : null}
    </section>
  );
}
