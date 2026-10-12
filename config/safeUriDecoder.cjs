"use strict";

// Legacy query-string expects a CommonJS function. Native decoding handles
// valid UTF-8 without the vulnerable package's recursive recovery algorithm.
module.exports = function safeUriDecoder(value) {
  if (typeof value !== "string") {
    throw new TypeError("Expected a string URI component");
  }
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    // Keep malformed values literal; do not attempt recursive partial decoding.
    return value;
  }
};
