import { createContext, useContext } from "react";

// Layout owns the getMe boot fetch; this just carries its result to
// descendants (first-visit tips, SettingsPage's About section) without
// prop-drilling through the route tree. `me` is null until that fetch
// resolves — default value keeps stray usage outside the provider inert
// (null `me`, no-op `setMe`) instead of throwing.
const MeContext = createContext({ me: null, setMe: () => {} });
export const useMe = () => useContext(MeContext);
export default MeContext;
