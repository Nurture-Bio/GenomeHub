import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import AuthProvider from './providers/AuthProvider';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--color-surface-3)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--font-size-caption)',
            },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
