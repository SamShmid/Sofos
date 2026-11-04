import { Routes, Route } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import HomePage from "./pages/HomePage";
import SettingsPage from "./pages/SettingsPage";
import WorkspacePage from "./pages/WorkspacePage";
import ProjectPage from "./pages/ProjectPage";
import NotePage from "./pages/NotePage";
import TrashPage from "./pages/TrashPage";
import RoadmapPage from "./pages/RoadmapPage";
import BoardPage from "./pages/BoardPage";
import NotFoundPage from "./pages/NotFoundPage";
import RequireAuth from "./components/RequireAuth";
import Layout from "./components/Layout";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Home, workspaces, projects, roadmaps and settings all share the sidebar layout */}
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<HomePage />} />
        <Route path="workspaces/:id" element={<WorkspacePage />} />
        <Route path="workspaces/:id/roadmap" element={<RoadmapPage containerType="workspace" />} />
        <Route path="workspaces/:id/board" element={<BoardPage containerType="workspace" />} />
        <Route path="projects/:id" element={<ProjectPage />} />
        <Route path="projects/:id/roadmap" element={<RoadmapPage containerType="project" />} />
        <Route path="projects/:id/board" element={<BoardPage containerType="project" />} />
        {/* P54: notes get their own page — "new" is a literal segment, so it
            always wins over the :id route below regardless of declaration
            order (React Router ranks static segments above dynamic ones). */}
        <Route path="notes/new" element={<NotePage />} />
        <Route path="notes/:id" element={<NotePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="trash" element={<TrashPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
