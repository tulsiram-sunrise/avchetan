import type { ColorScheme } from '@avchetan/shared';
import { useEffect, useState } from 'react';

const query = '(prefers-color-scheme: dark)';

/** Follows Windows' light or dark mode, as the stylesheet does. */
export function useColorScheme(): ColorScheme {
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return dark ? 'dark' : 'light';
}
