import { useAuth } from "../context/AuthContext";

export default function TaskItem({ task, onToggle, onDelete }) {
  const { isWriter } = useAuth();
  return (
    <li className={`task-item ${task.completed ? "completed" : ""}`}>
      <input
        type="checkbox"
        checked={task.completed}
        disabled={!isWriter}
        onChange={() => onToggle(task)}
      />
      <div className="task-body">
        <h4>{task.title}</h4>
        {task.content && <p>{task.content}</p>}
      </div>
      {isWriter && (
        <button className="delete-x" aria-label="Delete task" onClick={() => onDelete(task._id)}>×</button>
      )}
    </li>
  );
}
