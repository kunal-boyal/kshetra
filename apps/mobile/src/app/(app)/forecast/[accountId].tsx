import { useLocalSearchParams } from 'expo-router';
import { ForecastScreen } from '../../../screens/forecast';

/** `/forecast/<accountId>`: an account's forecast by item for the coming months, above the tabs. */
export default function ForecastRoute() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  return <ForecastScreen key={accountId} accountId={accountId} />;
}
