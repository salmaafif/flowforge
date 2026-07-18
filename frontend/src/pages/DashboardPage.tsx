import { AppLayout } from '../components/AppLayout';
import { HealthPanel } from '../components/HealthPanel';
import { WorkflowList } from '../components/WorkflowList';

/** Dashboard: global health panel + workflow table. */
export function DashboardPage() {
  return (
    <AppLayout title="Dashboard" subtitle="Real-time overview of workflow execution health">
      <div className="space-y-6">
        <HealthPanel />
        <WorkflowList />
      </div>
    </AppLayout>
  );
}
