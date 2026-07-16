import '@emdash/chat-ui/style.css';
import '@emdash/ui/style.css';
import { ThemeProvider } from '@emdash/ui/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { BrowserMobileClient } from './client/browser-client';
import { MobileClientProvider } from './client/context';
import { MockMobileClient } from './client/mock-client';
import './styles.css';

const demo = new URLSearchParams(window.location.search).get('demo') === '1';
const client = demo ? new MockMobileClient() : new BrowserMobileClient();

window.addEventListener('pagehide', () => client.dispose(), { once: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark">
      <MobileClientProvider client={client}>
        <App />
      </MobileClientProvider>
    </ThemeProvider>
  </StrictMode>
);
