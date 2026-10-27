const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test(
  "native paste detection treats a missing AT-SPI state set as unknown without GLib criticals",
  { skip: process.platform !== "linux", timeout: 30_000 },
  (t) => {
    const flags = spawnSync(
      "pkg-config",
      ["--cflags", "--libs", "atspi-2", "gobject-2.0", "x11", "xtst", "xext"],
      { encoding: "utf8", timeout: 5000 }
    );
    if (flags.error?.code === "ENOENT" || flags.status !== 0) {
      t.skip("pkg-config or AT-SPI/X11 development libraries unavailable");
      return;
    }
    assert.ifError(flags.error);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-atspi-paste-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const binary = path.join(directory, "linux-atspi-paste");
    const compiled = spawnSync(
      "cc",
      [
        path.join(__dirname, "../native/linuxAtspiPaste.c"),
        "-o",
        binary,
        ...flags.stdout.trim().split(/\s+/),
        "-lm",
      ],
      { encoding: "utf8", timeout: 10_000 }
    );
    if (compiled.error?.code === "ENOENT") {
      t.skip("C compiler unavailable");
      return;
    }
    assert.ifError(compiled.error);
    assert.equal(compiled.status, 0, compiled.stderr);

    const result = spawnSync(binary, [], { encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /AT-SPI missing state handled without GLib criticals/);
  }
);
