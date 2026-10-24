import type { QueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';
import type { ConsoleClient } from './client';

export interface ConsoleContext {
  client: ConsoleClient;
  queryClient: QueryClient;
}

const Context = createContext<ConsoleContext | null>(null);

export function ConsoleProvider({
  value,
  children,
}: {
  value: ConsoleContext;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConsole(): ConsoleContext {
  const context = useContext(Context);
  if (!context) throw new Error('useConsole needs a ConsoleProvider.');
  return context;
}
