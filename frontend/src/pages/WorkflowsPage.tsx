import { AppLayout } from '../components/AppLayout';
import { WorkflowList } from '../components/WorkflowList';

/** Workflows page: full workflow management with search, pagination, and actions. */
export function WorkflowsPage() {
  return (
    <AppLayout title="Workflows" subtitle="Manage and run your automation workflows">
      <WorkflowList />
    </AppLayout>
  );
}
