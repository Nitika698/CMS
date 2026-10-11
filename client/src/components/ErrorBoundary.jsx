import { Component } from 'react';
import { ErrorState } from './ui/index.js';

/** Last line of defence: a render error in one screen shows a recoverable message instead of a blank page. */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // Name only: never log component props/state, which may contain user data.
    console.error(`[ui] render error: ${error?.name}`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm" role="alert">
        <ErrorState title="Something went wrong on this screen" message="Your data is safe. Reload the page to try again." onRetry={() => window.location.reload()} />
      </div>
    );
  }
}
