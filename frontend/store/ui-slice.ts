import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Lang } from '@/lib/i18n';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

interface UiState {
  lang: Lang;
  sidebarOpen: boolean;
  toasts: Toast[];
  sessionExpired: boolean;
}

const initialState: UiState = { lang: 'hi', sidebarOpen: false, toasts: [], sessionExpired: false };
let nextToastId = 1;

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setLang(state, a: PayloadAction<Lang>) {
      state.lang = a.payload;
    },
    setSidebar(state, a: PayloadAction<boolean>) {
      state.sidebarOpen = a.payload;
    },
    pushToast: {
      reducer(state, a: PayloadAction<Toast>) {
        state.toasts = [...state.toasts.slice(-3), a.payload];
      },
      prepare(t: Omit<Toast, 'id'>) {
        return { payload: { ...t, id: nextToastId++ } };
      },
    },
    dismissToast(state, a: PayloadAction<number>) {
      state.toasts = state.toasts.filter((t) => t.id !== a.payload);
    },
    sessionExpired(state) {
      state.sessionExpired = true;
    },
    sessionRestored(state) {
      state.sessionExpired = false;
    },
  },
});

export const { setLang, setSidebar, pushToast, dismissToast, sessionExpired, sessionRestored } = uiSlice.actions;
