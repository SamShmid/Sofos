import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth } from "../context/AuthContext";

export default function NoteView({ note, onEdit }) {
  const { isWriter } = useAuth();
  return (
    <article className="note-view">
      <div className="note-view-head">
        <h2>{note.title}</h2>
        {isWriter && <button onClick={onEdit}>Edit</button>}
      </div>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content}</ReactMarkdown>
    </article>
  );
}
