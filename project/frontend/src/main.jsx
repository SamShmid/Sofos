import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "./context/ToastContext.jsx";
import { ConfirmProvider } from "./context/ConfirmContext.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { RefreshProvider } from "./context/RefreshContext.jsx";
import { ActiveWorkspaceProvider } from "./context/ActiveWorkspaceContext.jsx";
import { TagColorsProvider } from "./context/TagColorsContext.jsx";
import { getStoredPref, applyPref } from "./theme.js";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import App from "./App.jsx";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";

// Re-stamp the resolved theme at boot and, when pref is "system", arm the one
// matchMedia listener so live OS theme changes flip the UI without a Settings
// visit. Idempotent with index.html's pre-paint stamp.
applyPref(getStoredPref());

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <RefreshProvider>
              <ActiveWorkspaceProvider>
                <TagColorsProvider>
                  <ErrorBoundary>
                    <App />
                  </ErrorBoundary>
                </TagColorsProvider>
              </ActiveWorkspaceProvider>
            </RefreshProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);
