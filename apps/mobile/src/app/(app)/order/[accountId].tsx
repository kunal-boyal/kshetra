import { useLocalSearchParams } from 'expo-router';
import { OrderScreen } from '../../../screens/order';

/** `/order/<accountId>`: taking an order at an account, above the tabs. */
export default function OrderRoute() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  return <OrderScreen key={accountId} accountId={accountId} />;
}
