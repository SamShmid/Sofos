import { Link } from "react-router-dom";

// Home / <ancestor> / <ancestor> / current. `ancestors` is root-first
// { _id, name, kind: "workspace" | "project" } (the doc's own populated
// `ancestors` chain, optionally preceded by its container); `current` is
// plain text — the page you're already on isn't a link.
export default function Breadcrumbs({ ancestors = [], current }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to="/" className="crumb" title="Overview">Overview</Link>
      {ancestors.map((a) => (
        <span key={a._id}>
          <span className="crumb-sep"> / </span>
          <Link to={a.kind === "project" ? `/projects/${a._id}` : `/workspaces/${a._id}`} className="crumb" title={a.name}>
            {a.name}
          </Link>
        </span>
      ))}
      {current && (
        <span>
          <span className="crumb-sep"> / </span>
          <span className="crumb-current">{current}</span>
        </span>
      )}
    </nav>
  );
}
