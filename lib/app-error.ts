export type AppErrorKind = 'network' | 'server' | 'unknown';

export type AppError = {
  kind: AppErrorKind;
  message?: string;
  status?: number;
  cause?: unknown;
};

export function isAppError(err: unknown): err is AppError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'kind' in err &&
    typeof (err as { kind?: unknown }).kind === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(err: unknown): string | undefined {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (isRecord(err) && typeof err.message === 'string') return err.message;
  return undefined;
}

function isLikelyNetworkError(err: unknown): boolean {
  const message = getErrorMessage(err);
  if (!message) return false;
  return /network request failed|failed to fetch|load failed|internet connection appears to be offline/i.test(
    message,
  );
}

function getHttpStatus(err: unknown): number | undefined {
  if (!isRecord(err)) return undefined;
  const status = err.status;
  if (typeof status === 'number' && Number.isFinite(status)) return status;

  const response = err.response;
  if (isRecord(response) && typeof response.status === 'number')
    return response.status;

  return undefined;
}

export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;

  const status = getHttpStatus(err);
  const message = getErrorMessage(err);

  if (isLikelyNetworkError(err)) {
    return { kind: 'network', message, cause: err };
  }

  if (typeof status === 'number' && status >= 500) {
    return { kind: 'server', status, message, cause: err };
  }

  return { kind: 'unknown', status, message, cause: err };
}
