import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/layouts/AppLayout";
import { useAppStore } from "@/stores/AppContext";
import { LoadingState } from "@/components/shared/LoadingState";

const InitPage = lazy(() => import("@/features/init/InitPage").then((module) => ({ default: module.InitPage })));
const OverviewPage = lazy(() => import("@/features/overview/OverviewPage").then((module) => ({ default: module.OverviewPage })));
const LearnPage = lazy(() => import("@/features/learn/LearnPage").then((module) => ({ default: module.LearnPage })));
const MaterialsPage = lazy(() => import("@/features/materials/MaterialsPage").then((module) => ({ default: module.MaterialsPage })));
const DocumentDetailPage = lazy(() => import("@/features/materials/DocumentDetailPage").then((module) => ({ default: module.DocumentDetailPage })));
const DomainGraphPage = lazy(() => import("@/features/graph/DomainGraphPage").then((module) => ({ default: module.DomainGraphPage })));
const StudentGraphPage = lazy(() => import("@/features/graph/StudentGraphPage").then((module) => ({ default: module.StudentGraphPage })));
const PersonalModelPage = lazy(() => import("@/features/model/PersonalModelPage").then((module) => ({ default: module.PersonalModelPage })));
const LearningPathPage = lazy(() => import("@/features/path/LearningPathPage").then((module) => ({ default: module.LearningPathPage })));
const DomainVersionPage = lazy(() => import("@/features/history/VersionHistoryPage").then((module) => ({ default: module.DomainVersionPage })));
const LearnerVersionPage = lazy(() => import("@/features/history/VersionHistoryPage").then((module) => ({ default: module.LearnerVersionPage })));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const GlobalSearchPage = lazy(() => import("@/features/search/GlobalSearchPage").then((module) => ({ default: module.GlobalSearchPage })));

function ContextGuard() {
  const { currentWorkspace, currentLearner } = useAppStore();
  return currentWorkspace && currentLearner ? (
    <Outlet />
  ) : (
    <Navigate to="/init" replace />
  );
}

function RootRedirect() {
  const { currentWorkspace, currentLearner } = useAppStore();
  return (
    <Navigate
      to={currentWorkspace && currentLearner ? "/overview" : "/init"}
      replace
    />
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingState label="正在打开页面" />}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/init" element={<InitPage />} />
        <Route element={<AppLayout />}>
          <Route path="/settings" element={<SettingsPage />} />
          <Route element={<ContextGuard />}>
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/search" element={<GlobalSearchPage />} />
            <Route path="/learn" element={<LearnPage />} />
            <Route path="/materials" element={<MaterialsPage />} />
            <Route path="/materials/:documentId" element={<DocumentDetailPage />} />
            <Route path="/graph/domain" element={<DomainGraphPage />} />
            <Route path="/graph/student" element={<StudentGraphPage />} />
            <Route path="/model" element={<PersonalModelPage />} />
            <Route path="/learning-path" element={<LearningPathPage />} />
            <Route path="/history" element={<Navigate to="/history/domain" replace />} />
            <Route path="/history/domain" element={<DomainVersionPage />} />
            <Route path="/history/learner" element={<LearnerVersionPage />} />
          </Route>
        </Route>
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Suspense>
  );
}
