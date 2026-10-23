import { useLocalSearchParams } from 'expo-router';
import { PricesScreen } from '../../../screens/prices';

/** `/prices/<accountId>`: an account's prices, above the tabs. */
export default function PricesRoute() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  return <PricesScreen key={accountId} accountId={accountId} />;
}
