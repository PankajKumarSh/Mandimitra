'use client';

import { useState, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { Toaster } from '@/components/ui';
import { useRestoreLanguage } from '@/hooks';
import { makeStore } from '@/store';

function LanguageRestorer() {
  useRestoreLanguage();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [store] = useState(makeStore);
  return (
    <Provider store={store}>
      <LanguageRestorer />
      {children}
      <Toaster />
    </Provider>
  );
}
