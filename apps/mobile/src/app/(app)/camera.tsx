import { PhotoKind } from '@thelamp/shared';
import { useLocalSearchParams } from 'expo-router';
import { CameraScreen } from '../../screens/camera';

/** `/camera?kind=evidence&request=<id>`: the screen that opened it collects the photos. */
export default function CameraRoute() {
  const { kind, request } = useLocalSearchParams<{ kind?: string; request?: string }>();
  const parsed = PhotoKind.safeParse(kind);
  return <CameraScreen kind={parsed.success ? parsed.data : 'evidence'} request={request ?? ''} />;
}
