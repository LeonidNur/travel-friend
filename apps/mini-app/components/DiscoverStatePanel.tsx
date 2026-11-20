import type { ReactNode } from 'react';

export function DiscoverStatePanel({ title, message, action, error = false }: Readonly<{
  title: string; message?: string; action?: ReactNode; error?: boolean;
}>) {
  return <article className="discover-state" role={error ? 'alert' : 'status'}><h2>{title}</h2>{message ? <p>{message}</p> : null}{action}</article>;
}
