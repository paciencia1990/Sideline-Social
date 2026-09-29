import assert from "node:assert/strict";

import { classifySquadCallableError } from "../utils/squadCallableError.ts";

assert.equal(classifySquadCallableError({ code: "functions/not-found" }), "service-unavailable");
assert.equal(classifySquadCallableError({ code: "functions/unimplemented" }), "service-unavailable");
assert.equal(classifySquadCallableError({ code: "functions/unauthenticated" }), "authentication-required");
assert.equal(classifySquadCallableError({ code: "functions/permission-denied" }), "permission-denied");
assert.equal(classifySquadCallableError({ code: "functions/deadline-exceeded" }), "temporarily-unavailable");
assert.equal(classifySquadCallableError(new Error("private provider response")), "unknown");

console.log("Squad callable error classification tests passed.");
