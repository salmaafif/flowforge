import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from './auth/ProtectedRoute';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { RunHistoryPage } from './pages/RunHistoryPage';
import { RunPage } from './pages/RunPage';
import { WorkflowEditorPage } from './pages/WorkflowEditorPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/workflows/new"
          element={
            <ProtectedRoute>
              <WorkflowEditorPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/workflows/:workflowId/edit"
          element={
            <ProtectedRoute>
              <WorkflowEditorPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/runs/:runId"
          element={
            <ProtectedRoute>
              <RunPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/workflows/:workflowId/runs"
          element={
            <ProtectedRoute>
              <RunHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
