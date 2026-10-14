import { useLocalSearchParams } from 'expo-router';
import { ReviewItemScreen } from '../../../screens/review-item';

/** `/review/<id>`: one submission to decide, above the tabs. */
export default function ReviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReviewItemScreen key={id} id={id} />;
}
