const TransformEngine = require("./vendor/transform-engine.js");
const TransformShared = require("./vendor/transform-shared.js");
const StructuredDictionary = require("./vendor/structured-dictionary.js");

// Stable Node-side entry point for Phase 1. Worker/browser adapters can load
// the vendor modules directly because they retain their UMD-compatible shape.
module.exports = Object.freeze({
  version: "0.1.0-phase1",
  engine: TransformEngine,
  shared: TransformShared,
  dictionary: StructuredDictionary,
});
