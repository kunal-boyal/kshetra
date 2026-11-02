import { useLocalSearchParams } from 'expo-router';
import { StockCountScreen } from '../../../screens/stock-count';

/** `/stock-count/<accountId>`: counting an account's stock, above the tabs. */
export default function StockCountRoute() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  return <StockCountScreen key={accountId} accountId={accountId} />;
}
