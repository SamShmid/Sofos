import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProjectCard({ project, onDelete }) {
  const { isWriter } = useAuth();
  const navigate = useNavigate();

  return (
    <article className="project-card" onClick={() => navigate(`/projects/${project._id}`)}>
      {isWriter && !project.isDefault && (
        <button
          className="delete-x"
          aria-label="Delete project"
          onClick={(e) => { e.stopPropagation(); onDelete(project._id); }}
        >
          ×
        </button>
      )}
      <h3>{project.name}</h3>
      {project.description && <p>{project.description}</p>}
    </article>
  );
}
