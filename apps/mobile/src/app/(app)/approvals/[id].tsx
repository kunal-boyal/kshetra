import { useLocalSearchParams } from 'expo-router';
import { ApprovalItemScreen } from '../../../screens/approval-item';

/** `/approvals/<id>`: one request to decide, above the tabs. */
export default function ApprovalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ApprovalItemScreen key={id} id={id} />;
}
