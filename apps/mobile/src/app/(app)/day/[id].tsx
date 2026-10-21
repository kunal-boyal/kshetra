import { useLocalSearchParams } from 'expo-router';
import { PersonDayScreen } from '../../../screens/person-day';

/** `/day/<id>`: a person's day and route, above the tabs. */
export default function PersonDayRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PersonDayScreen key={id} userId={id} />;
}
