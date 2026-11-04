import { useNavigate } from "react-router-dom";
import { canWrite } from "../utils/roles";
import { resolveTagColor, tenantIdOf } from "../utils/tags";
import { useTagColors } from "../context/TagColorsContext";

// Every listed project carries the effectiveRole inherited from its workspace.
// No task-count fields ride along on the list response, so `.meta` is skipped
// entirely rather than added — the vocabulary calls for it "if present in props".
export default function ProjectCard({ project, onDelete, onArchive, onRestore }) {
  const navigate = useNavigate();
  const { maps } = useTagColors();
  // WorkspacePage's list feeds this (its own project.superWorkspace comes back
  // raw, unpopulated) — resolution only here, no popover (spec: management
  // lives on ProjectForm/ProjectPage's chips, not the read-only card).
  const tenantId = tenantIdOf(project.superWorkspace);

  return (
    <article className="pcard" onClick={() => navigate(`/projects/${project._id}`)}>
      {canWrite(project.effectiveRole) && project.archivedAt && onRestore && (
        <button className="pcard-action" onClick={(e) => { e.stopPropagation(); onRestore(project); }}>Restore</button>
      )}
      {canWrite(project.effectiveRole) && !project.archivedAt && onArchive && (
        <button className="pcard-action" onClick={(e) => { e.stopPropagation(); onArchive(project); }}>Archive</button>
      )}
      {canWrite(project.effectiveRole) && onDelete && (
        <button className="delete-x" aria-label="Delete project" onClick={(e) => { e.stopPropagation(); onDelete(project); }}>×</button>
      )}
      <h3 title={project.name}>{project.name}</h3>
      <span className={`status-chip project-${project.status || "active"}`}>
        {project.archivedAt ? "Archived" : project.status || "active"}
      </span>
      {project.description && <p>{project.description}</p>}
      {project.tags?.length > 0 && (
        <div className="pcard-tags">
          {project.tags.map((t) => (
            <span key={t} className={`tag-chip c${resolveTagColor(t, tenantId, maps)}`}>{t}</span>
          ))}
        </div>
      )}
    </article>
  );
}
