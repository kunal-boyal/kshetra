import { useLocalSearchParams } from 'expo-router';
import { NewAccountScreen } from '../../../screens/new-account';

export default function NewAccountRoute() {
  const { type } = useLocalSearchParams<{ type: string }>();
  return <NewAccountScreen typeKey={type} />;
}
