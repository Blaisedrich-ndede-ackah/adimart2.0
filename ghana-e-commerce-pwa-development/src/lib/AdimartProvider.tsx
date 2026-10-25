import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getAdimartStore, type AdimartStoreProfile } from '@/lib/adimart';

interface AdimartState {
  store: AdimartStoreProfile | null;
  loading: boolean;
  error: string;
}

const AdimartContext = createContext<AdimartState>({
  store: null,
  loading: true,
  error: '',
});

export function AdimartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdimartState>({ store: null, loading: true, error: '' });

  useEffect(() => {
    let active = true;
    getAdimartStore()
      .then((store) => {
        if (active) setState({ store, loading: false, error: '' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          store: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Could not open this Adimat shop.',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  return <AdimartContext.Provider value={state}>{children}</AdimartContext.Provider>;
}

export function useAdimartStore(): AdimartState {
  return useContext(AdimartContext);
}
