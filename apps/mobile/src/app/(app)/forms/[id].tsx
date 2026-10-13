import { useLocalSearchParams } from 'expo-router';
import { FormEntryScreen } from '../../../screens/form-entry';

/** `/forms/<entry>`: a form entry, full screen above the tabs. */
export default function FormEntryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FormEntryScreen key={id} id={id ?? ''} />;
}
