import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeLayerStack,
  isTopLayer,
  layerStackIsEmpty,
  popLayer,
  pushLayer,
  topLayerKind,
} from "../src/renderer/layerStack.js";

test("layer registry orders semantic rank before registration sequence", () => {
  const card = pushLayer("connection-focus");
  const selection = pushLayer("marking-selection");
  const session = pushLayer("marking-session");
  const preview = pushLayer("preview");
  try {
    assert.equal(topLayerKind(), "marking-session");
    assert.equal(isTopLayer(session), true);
    assert.equal(isTopLayer(card), false);
    assert.deepEqual(
      describeLayerStack().map((entry) => entry.split("#")[0]),
      ["preview", "marking-selection", "connection-focus", "marking-session"],
    );
  } finally {
    popLayer(preview);
    popLayer(session);
    popLayer(selection);
    popLayer(card);
  }
  assert.equal(layerStackIsEmpty(), true);
});

test("later layers win ties and popping restores the prior owner", () => {
  const first = pushLayer("dialog");
  const second = pushLayer("dialog");
  try {
    assert.equal(isTopLayer(second), true);
    popLayer(second);
    assert.equal(isTopLayer(first), true);
  } finally {
    popLayer(second);
    popLayer(first);
  }
  assert.equal(topLayerKind(), null);
});
