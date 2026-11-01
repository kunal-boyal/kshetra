import { useLocalSearchParams } from 'expo-router';
import { SellThroughScreen } from '../../../screens/sell-through';

/** `/sell-through/<accountId>`: an account's stock statement for the month, above the tabs. */
export default function SellThroughRoute() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  return <SellThroughScreen key={accountId} accountId={accountId} />;
}
