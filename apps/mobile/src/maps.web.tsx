import type { GeoPoint } from '@kshetra/shared';
import { Notice } from '@kshetra/ui-mobile';
import type { ReactNode } from 'react';
import { useLanguage } from './i18n';

/**
 * The browser stand-in for the phone's maps: react-native-maps has no web build, and the web
 * target exists only for development. A map says so; what it would show is in words beside it.
 */

export type { SpotTone } from './maps';

export const useSpotColour = (): string => '';

export function PhoneMap({
  label,
}: {
  label: string;
  fit: readonly GeoPoint[];
  frame?: string;
  height?: number;
  children?: ReactNode;
}) {
  const { t } = useLanguage();
  return <Notice>{`${label}: ${t('maps.phone_only')}`}</Notice>;
}

export const Spot = (): null => null;

export const Ring = (): null => null;

export const Line = (): null => null;
