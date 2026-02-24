import { type ReactNode } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { Card, Button, Heading, Text } from '../ui';

function Fallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="flex items-center justify-center p-6">
      <Card elevated className="p-3 max-w-md">
        <Heading level="subheading" className="mb-1">Something went wrong</Heading>
        <Text variant="dim" as="p" className="mb-2">
          {error instanceof Error ? error.message : 'An unexpected error occurred.'}
        </Text>
        <Button intent="primary" size="sm" onClick={resetErrorBoundary}>
          Try again
        </Button>
      </Card>
    </div>
  );
}

export default function PageErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary FallbackComponent={Fallback}>
      {children}
    </ErrorBoundary>
  );
}
