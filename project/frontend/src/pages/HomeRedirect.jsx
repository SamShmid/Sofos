import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getWorkspaces } from "../services/workspacesService";

// The "/" landing: send the user to the Home (default) workspace.
export default function HomeRedirect() {
  const [homeId, setHomeId] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getWorkspaces()
      .then((ws) => {
        const home = ws.find((w) => w.isDefault) || ws[0];
        home ? setHomeId(home._id) : setFailed(true);
      })
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p>No workspaces found.</p>;
  if (!homeId) return <p>Loading…</p>;
  return <Navigate to={`/workspaces/${homeId}`} replace />;
}
