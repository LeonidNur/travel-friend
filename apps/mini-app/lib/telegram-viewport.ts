export interface TelegramInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TelegramViewport {
  viewportHeight: number;
  viewportStableHeight: number;
  safeAreaInset: TelegramInsets;
  contentSafeAreaInset: TelegramInsets;
}

export type TelegramViewportEvent =
  | 'viewportChanged'
  | 'safeAreaChanged'
  | 'contentSafeAreaChanged'
  | 'activated';

export interface TelegramViewportApi {
  viewportHeight?: number;
  viewportStableHeight?: number;
  safeAreaInset?: Partial<TelegramInsets>;
  contentSafeAreaInset?: Partial<TelegramInsets>;
  onEvent?: (event: TelegramViewportEvent, handler: () => void) => void;
  offEvent?: (event: TelegramViewportEvent, handler: () => void) => void;
}

const viewportEvents: readonly TelegramViewportEvent[] = [
  'viewportChanged',
  'safeAreaChanged',
  'contentSafeAreaChanged',
  'activated'
];

function normalizeInset(inset: Partial<TelegramInsets> | undefined): TelegramInsets {
  const read = (side: keyof TelegramInsets) => {
    const value = inset?.[side];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  };

  return { top: read('top'), right: read('right'), bottom: read('bottom'), left: read('left') };
}

function positiveHeight(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getTelegramViewport(
  webApp: TelegramViewportApi | undefined,
  browserHeight: number
): TelegramViewport {
  const fallbackHeight = positiveHeight(browserHeight, 0);
  const height = positiveHeight(webApp?.viewportHeight, fallbackHeight);

  return {
    viewportHeight: height,
    viewportStableHeight: positiveHeight(webApp?.viewportStableHeight, height),
    safeAreaInset: normalizeInset(webApp?.safeAreaInset),
    contentSafeAreaInset: normalizeInset(webApp?.contentSafeAreaInset)
  };
}

export function subscribeTelegramViewport(
  webApp: TelegramViewportApi,
  browserHeight: number,
  onChange: (viewport: TelegramViewport) => void
): () => void {
  const refresh = () => onChange(getTelegramViewport(webApp, browserHeight));

  refresh();

  if (!webApp.onEvent) {
    return () => undefined;
  }

  viewportEvents.forEach((event) => webApp.onEvent?.(event, refresh));

  return () => {
    viewportEvents.forEach((event) => webApp.offEvent?.(event, refresh));
  };
}
