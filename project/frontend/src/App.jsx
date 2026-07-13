import { Routes, Route } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import HomeRedirect from "./pages/HomeRedirect";
import WorkspacePage from "./pages/WorkspacePage";
import ProjectPage from "./pages/ProjectPage";
import RequireAuth from "./components/RequireAuth";
import Layout from "./components/Layout";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Workspace views share the workspaces-sidebar layout */}
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<HomeRedirect />} />
        <Route path="workspaces/:id" element={<WorkspacePage />} />
      </Route>

      {/* Project page is its own focused view (its sidebar shows the project's contents) */}
      <Route path="/projects/:id" element={<RequireAuth><ProjectPage /></RequireAuth>} />
    </Routes>
  );
}
