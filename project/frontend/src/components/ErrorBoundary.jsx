import { Component } from "react";

// getDerivedStateFromError/componentDidCatch is the only React API for
// catching render errors — no hook equivalent exists, so this stays a class.
// Wraps <App/> in main.jsx; a quiet branded fallback, no error details in UI.
export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error(error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Something went wrong</h3>
            <p>Reload to continue</p>
            <button className="btn btn-primary" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
