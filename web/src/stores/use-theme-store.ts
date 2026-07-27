import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    themeUpdatedAt: string;
    setTheme: (theme: ThemeName, updatedAt?: string) => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "dark",
            themeUpdatedAt: "",
            setTheme: (theme, updatedAt = new Date().toISOString()) => set({ theme, themeUpdatedAt: updatedAt }),
        }),
        {
            name: "infinite-canvas:theme_store",
            partialize: (state) => ({ theme: state.theme, themeUpdatedAt: state.themeUpdatedAt }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ThemeStore>;
                return {
                    ...current,
                    theme: persistedState.theme === "light" ? "light" : "dark",
                    themeUpdatedAt: typeof persistedState.themeUpdatedAt === "string" ? persistedState.themeUpdatedAt : "",
                };
            },
        },
    ),
);
