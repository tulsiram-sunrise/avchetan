import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { vars } from 'nativewind';
import type { ReactNode } from 'react';
import { useColorScheme, View } from 'react-native';
import tokens from './tokens.json';

export type Palette = typeof tokens.light;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? tokens.dark : tokens.light;
}

const toVariables = (palette: Palette) =>
  vars(Object.fromEntries(Object.entries(palette).map(([name, color]) => [`--${name}`, color])));

/** Sets the colors for NativeWind classes and for React Navigation's headers and tabs. */
export function AppTheme({ children }: { children: ReactNode }) {
  const palette = usePalette();
  const base = useColorScheme() === 'dark' ? DarkTheme : DefaultTheme;
  const navigation = {
    ...base,
    colors: {
      ...base.colors,
      primary: palette.accent,
      background: palette.surface,
      card: palette.surfaceRaised,
      text: palette.ink,
      border: palette.line,
    },
  };

  return (
    <View className="flex-1" style={toVariables(palette)}>
      <ThemeProvider value={navigation}>{children}</ThemeProvider>
    </View>
  );
}
