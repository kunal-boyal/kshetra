import { useLocalSearchParams } from 'expo-router';
import { ScanScreen } from '../../screens/scan';

/** `/scan?request=<id>`: the screen that opened it collects the code. */
export default function ScanRoute() {
  const { request } = useLocalSearchParams<{ request?: string }>();
  return <ScanScreen request={request ?? ''} />;
}
