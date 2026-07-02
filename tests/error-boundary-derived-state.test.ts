import assert from "node:assert/strict";
import { test } from "node:test";
import { ErrorBoundary } from "../src/renderer/components/ErrorBoundary.js";

// NOTE: This only covers the pure static getDerivedStateFromError method.
// componentDidCatch and the fallback render() output are NOT covered here —
// exercising those requires mounting the component (jsdom/react-test-renderer),
// which is not installed in this ABI-independent test harness.

test("getDerivedStateFromError returns hasError:true with the same Error instance", () => {
  const error = new Error("boom");
  const state = ErrorBoundary.getDerivedStateFromError(error);

  assert.equal(state.hasError, true);
  assert.equal(state.error, error, "should carry forward the exact same Error instance");
  assert.equal(state.error?.message, "boom");
  assert.equal(state.error?.stack, error.stack);
});
