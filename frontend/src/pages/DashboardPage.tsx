import { AppLayout } from '../components/AppLayout';
import { HealthPanel } from '../components/HealthPanel';
import { WorkflowList } from '../components/WorkflowList';

/** Dashboard: global health panel over the tenant's workflow list. */
export function DashboardPage() {
  return (
    <AppLayout title="Dashboard" subtitle="Live health and your workflows">
      <div className="space-y-8">
        <HealthPanel />
        <WorkflowList />
      </div>
    </AppLayout>
  );
}
