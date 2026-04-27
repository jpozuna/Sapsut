import type { PropsWithChildren } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { AppErrorState } from '@/components/app-error-state';
import { toAppError } from '@/lib/app-error';

export type AppErrorBoundaryProps = PropsWithChildren<{
  onResetToSafeRoute?: () => void;
}>;

export function AppErrorBoundary({
  children,
  onResetToSafeRoute,
}: AppErrorBoundaryProps) {
  return (
    <ErrorBoundary
      onReset={onResetToSafeRoute}
      fallbackRender={({ error, resetErrorBoundary }) => (
        <AppErrorState
          error={toAppError(error)}
          onRetry={() => {
            // Avoid double-reset loops:
            // - `resetErrorBoundary()` triggers ErrorBoundary's `onReset`
            // - calling `onResetToSafeRoute` here would fire it twice
            resetErrorBoundary();
          }}
          titleOverride="App error"
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
