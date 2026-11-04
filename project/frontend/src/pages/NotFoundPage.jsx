import { Link } from "react-router-dom";

// Catch-all for any URL that doesn't match a route (P47 ruling 22) — renders
// inside Layout's Outlet so authed users still get the header/sidebar shell
// instead of a blank page.
export default function NotFoundPage() {
  return (
    <div className="not-found">
      <h1>Page not found</h1>
      <p>The page you're looking for doesn't exist or may have moved.</p>
      <Link to="/">← Overview</Link>
    </div>
  );
}
