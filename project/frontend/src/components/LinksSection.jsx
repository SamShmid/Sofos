import { useEffect, useState } from "react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import Modal from "./Modal";
import LinkForm from "./LinkForm";
import { getLinks, createLink, updateLink, reorderLinks, deleteLink } from "../services/linksService";
import { createSuggestion } from "../services/suggestionsService";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { clearDraft } from "../utils/draftStash";

// Links list for a workspace or project container. Mirrors goals' manual
// reorder (dense per-container `order` + drag handles), but links are
// immovable between containers and carry no roadmap/summary rollup.
// canSuggest (pure suggesters) reuses the same list/form but routes create/
// edit/delete through a suggestion instead of a direct write; reorder stays
// canWrite-only (order is never suggestable).
export default function LinksSection({ container, canWrite, canSuggest }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [links, setLinks] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingLink, setEditingLink] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const loadLinks = () =>
    getLinks(container)
      .then((data) => { setLinks(data); setError(null); setLoaded(true); })
      .catch(() => { setError("Could not load links"); setLoaded(true); });

  useEffect(() => {
    let ignore = false;
    getLinks(container)
      .then((data) => { if (!ignore) { setLinks(data); setError(null); setLoaded(true); } })
      .catch(() => { if (!ignore) { setError("Could not load links"); setLoaded(true); } });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container.workspace, container.project, container.includeSubprojects]);

  async function handleCreate(data) {
    if (canWrite) {
      await createLink({ ...data, ...container });
      setShowForm(false);
      await loadLinks();
      return;
    }
    await createSuggestion({ resourceType: "Link", op: "create", ...container, payload: data });
    toast.success("Suggested — awaiting a writer's approval");
    setShowForm(false);
  }

  async function handleSaveEdit(data) {
    if (canWrite) {
      await updateLink(editingLink._id, data, editingLink.__v);
      setEditingLink(null);
      await loadLinks();
      return;
    }
    await createSuggestion({ resourceType: "Link", op: "update", resource: editingLink._id, payload: data });
    toast.success("Suggested — awaiting a writer's approval");
    setEditingLink(null);
  }

  async function handleDelete(link) {
    if (canWrite) {
      const ok = await confirm({
        title: "Move to trash",
        message: `Move "${link.title}" to trash?`,
        confirmLabel: "Move to trash",
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteLink(link._id);
        await loadLinks();
      } catch (err) {
        toast.error(err.message);
      }
      return;
    }
    const ok = await confirm({
      title: "Suggest deletion",
      message: `Suggest deleting "${link.title}"?`,
      confirmLabel: "Suggest",
      danger: true,
    });
    if (!ok) return;
    try {
      await createSuggestion({ resourceType: "Link", op: "delete", resource: link._id });
      toast.success("Suggested — awaiting a writer's approval");
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = links.map((l) => l._id);
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    const newIds = arrayMove(ids, oldIndex, newIndex);

    const byId = new Map(links.map((l) => [l._id, l]));
    setLinks(newIds.map((lid) => byId.get(lid)));
    try {
      await reorderLinks(container, newIds);
    } catch (err) {
      toast.error(err.message);
      await loadLinks();
    }
  }

  if (!canWrite && !canSuggest && !error && links.length === 0) return null;

  return (
    <div>
      <div className="section-label">Links{loaded && !error ? ` · ${links.length}` : ""}</div>
      {error && <p role="alert">{error}</p>}
      {loaded && !error && (
        <>
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={links.map((l) => l._id)} strategy={verticalListSortingStrategy}>
              <ul className="row-list">
                {links.map((link) => (
                  <LinkRow
                    key={link._id}
                    link={link}
                    canWrite={canWrite}
                    canSuggest={canSuggest}
                    onEdit={setEditingLink}
                    onDelete={handleDelete}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          {(canWrite || canSuggest) &&
            (showForm ? (
              <LinkForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
            ) : (
              <button className="add-inline" onClick={() => setShowForm(true)}>
                {canWrite ? "+ Link" : "+ Suggest link"}
              </button>
            ))}
        </>
      )}

      {editingLink && (
        <Modal
          title="Edit link"
          onClose={() => setEditingLink(null)}
          onDeliberateClose={() => { clearDraft(`link-edit:${editingLink._id}`); setEditingLink(null); }}
        >
          <LinkForm initial={editingLink} draftKey={`link-edit:${editingLink._id}`} onSubmit={handleSaveEdit} onCancel={() => setEditingLink(null)} />
        </Modal>
      )}
    </div>
  );
}

function LinkRow({ link, canWrite, canSuggest, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: link._id,
    disabled: !canWrite,
  });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li ref={setNodeRef} style={style}>
      {canWrite && (
        <span className="goal-drag-handle" aria-label="Drag to reorder" {...attributes} {...listeners}>
          ⠿
        </span>
      )}
      <span className="glyph">↗</span>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        title={link.description ? `${link.title} — ${link.description}` : link.title}
      >
        {link.title}
      </a>
      <span className="meta">added {new Date(link.createdAt).toLocaleDateString()}</span>
      {(canWrite || canSuggest) && (
        <>
          <button type="button" className="goal-edit-btn" aria-label="Edit link" onClick={() => onEdit(link)}>
            ✎
          </button>
          <button type="button" className="delete-x" aria-label="Delete link" onClick={() => onDelete(link)}>
            ×
          </button>
        </>
      )}
    </li>
  );
}
