import { useLocalSearchParams } from 'expo-router';
import { CollectScreen } from '../../../screens/collect';

/** `/collect/<accountId>`: taking a payment at an account, above the tabs. */
export default function CollectRoute() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  return <CollectScreen key={accountId} accountId={accountId} />;
}
