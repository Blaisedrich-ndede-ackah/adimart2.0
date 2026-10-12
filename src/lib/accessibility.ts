import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AccessibilityFontSize = 'normal' | 'large' | 'larger';

interface AccessibilityPreferences {
  fontSize: AccessibilityFontSize;
  highContrast: boolean;
  leftHanded: boolean;
}

interface AccessibilityState extends AccessibilityPreferences {
  setFontSize: (fontSize: AccessibilityFontSize) => void;
  setHighContrast: (enabled: boolean) => void;
  setLeftHanded: (enabled: boolean) => void;
}

function applyAccessibilityPreferences(preferences: AccessibilityPreferences): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.fontSize = preferences.fontSize;
  root.dataset.highContrast = String(preferences.highContrast);
  root.dataset.handedness = preferences.leftHanded ? 'left' : 'right';
}

export const useAccessibilityStore = create<AccessibilityState>()(
  persist(
    (set) => ({
      fontSize: 'normal',
      highContrast: false,
      leftHanded: false,
      setFontSize: (fontSize) =>
        set((state) => {
          const next = { ...state, fontSize };
          applyAccessibilityPreferences(next);
          return { fontSize };
        }),
      setHighContrast: (highContrast) =>
        set((state) => {
          const next = { ...state, highContrast };
          applyAccessibilityPreferences(next);
          return { highContrast };
        }),
      setLeftHanded: (leftHanded) =>
        set((state) => {
          const next = { ...state, leftHanded };
          applyAccessibilityPreferences(next);
          return { leftHanded };
        }),
    }),
    {
      name: 'adimat_accessibility',
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('[Accessibility] Could not load saved preferences:', error);
          return;
        }
        if (state) applyAccessibilityPreferences(state);
      },
    }
  )
);
