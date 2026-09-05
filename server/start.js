if (process.argv.includes("--harness")) await import("./harness.js");
else await import("./api.js");
