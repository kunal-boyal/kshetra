import { useLocalSearchParams } from 'expo-router';
import { AccountScreen } from '../../../screens/account';

export default function AccountRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AccountScreen key={id} id={id} />;
}
