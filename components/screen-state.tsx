import type { PropsWithChildren } from 'react';

import { AppErrorState } from '@/components/app-error-state';
import { AppLoading } from '@/components/app-loading';
import { toAppError } from '@/lib/app-error';

export type ScreenStateProps = PropsWithChildren<{
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  loadingLabel?: string;
}>;

export function ScreenState({
  isLoading,
  error,
  onRetry,
  loadingLabel,
  children,
}: ScreenStateProps) {
  if (isLoading) return <AppLoading label={loadingLabel} />;
  if (error)
    return <AppErrorState error={toAppError(error)} onRetry={onRetry} />;
  return children;
}
