/** Minimal browser implementation of the assertion API used by textlint rules. */
function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

assert.ok = assert;
module.exports = assert;
