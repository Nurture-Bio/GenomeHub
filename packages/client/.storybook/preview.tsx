import type { Preview } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initialize, mswLoader } from 'msw-storybook-addon';
import '../src/index.css';

// Start MSW — intercepts fetch/XHR in the browser
initialize();

// Shared client for all stories — no retries, no refetch on window focus
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    layout: 'centered',
    a11y: {
      test: 'todo',
    },
  },
  loaders: [mswLoader],
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <div
          style={{
            background: 'var(--color-void)',
            padding: '2rem',
            minHeight: '100vh',
            width: '100%',
          }}
        >
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};

export default preview;
