import { createContext, type ReactNode, useContext } from 'react';
import type { AppServices } from './app-services';

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider(props: { services: AppServices; children: ReactNode }) {
  return <ServicesContext value={props.services}>{props.children}</ServicesContext>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside ServicesProvider');
  return services;
}
