import { strict as assert } from "node:assert";
import { buildPrompt, listSkills } from "./skills.js";

assert.ok(listSkills().includes("concise"));
assert.match(buildPrompt("hello", ["concise"]), /## User request\nhello$/);
console.log("self-check: ok");
