const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const {
  discoverAndroidSdk,
  parseAvdList,
  parseAdbDevices,
  isSafeAvdName,
  buildAvdLaunchArgs,
  createAndroidService,
  fleetName,
  resetLaunchState,
} = require("./android-service.cjs");

test.beforeEach(() => {
  resetLaunchState();
});

/**
 * Shared harness. Everything the service shells out to is faked, so the tests
 * assert on the argument arrays and on the control flow rather than on Windows.
 */
function createHarness(config = {}) {
  const calls = [];
  const flags = { launched: false, recovered: false };
  const spawnedSerials = [];
  const avds = config.avds || ["Pixel_9_API_36"];

  const execFileAsync = async (file, args) => {
    calls.push({ type: "exec", file, args });

    if (args[0] === "-list-avds")
      return { stdout: `${avds.join("\n")}\n`, stderr: "" };
    if (args[0] === "start-server") return { stdout: "", stderr: "" };
    if (args[0] === "reconnect") {
      flags.recovered = true;
      return { stdout: "reconnecting\n", stderr: "" };
    }
    if (args[0] === "devices") {
      const devices = config.devices
        ? config.devices({
            launched: flags.launched,
            recovered: flags.recovered,
            spawnedSerials,
          })
        : [
            ...(config.preAttached || []),
            ...spawnedSerials.map((serial) => ({ serial, state: "device" })),
          ];
      const body = devices.map((d) => `${d.serial}\t${d.state}`).join("\n");
      return {
        stdout: `List of devices attached\n${body}${body ? "\n" : ""}`,
        stderr: "",
      };
    }
    if (args.includes("getprop")) {
      return {
        stdout: `${config.getprop === undefined ? "1" : config.getprop}\n`,
        stderr: "",
      };
    }
    if (args.includes("emu") && args.includes("avd") && args.includes("name")) {
      const serial = args[1];
      const name = config.avdNameFor ? config.avdNameFor(serial) : avds[0];
      return { stdout: `${name}\nOK\n`, stderr: "" };
    }
    if (args.includes("pm") && args.includes("path")) {
      return {
        stdout: "package:/data/app/com.android.chrome/base.apk\n",
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  };

  const spawn = (file, args, spawnOptions) => {
    calls.push({ type: "spawn", file, args, options: spawnOptions });
    flags.launched = true;
    const portIndex = args.indexOf("-port");
    if (portIndex >= 0) spawnedSerials.push(`emulator-${args[portIndex + 1]}`);
    if (config.spawn) return config.spawn(file, args, spawnOptions);
    return { pid: 4000 + calls.length, unref() {} };
  };

  const service = createAndroidService({
    env: { ANDROID_SDK_ROOT: "C:\\Android\\Sdk", ...(config.env || {}) },
    existsSync: () => true,
    execFileAsync,
    spawn,
    sleep: config.sleep || (async () => undefined),
  });

  return { service, calls, flags };
}

const spawnCalls = (calls) => calls.filter((call) => call.type === "spawn");

test("discovers the Android SDK and returns resolved tool paths", () => {
  const seen = [];
  const result = discoverAndroidSdk(
    {
      ANDROID_SDK_ROOT: "C:\\Android\\Sdk",
      LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
    },
    (candidate) => {
      seen.push(candidate);
      return candidate.includes("Android\\Sdk");
    },
  );

  assert.equal(result.sdkPath, path.win32.normalize("C:\\Android\\Sdk"));
  assert.equal(
    result.adbPath.endsWith(path.win32.join("platform-tools", "adb.exe")),
    true,
  );
  assert.equal(
    result.emulatorPath.endsWith(path.win32.join("emulator", "emulator.exe")),
    true,
  );
  assert.ok(seen.length >= 1);
});

test("returns empty tool paths when no SDK is present", () => {
  const result = discoverAndroidSdk({}, () => false);
  assert.deepEqual(result, { sdkPath: "", adbPath: "", emulatorPath: "" });
});

test("parses AVD list and adb devices output", () => {
  assert.deepEqual(parseAvdList("Pixel_9_API_36\r\nTablet_API_35\r\n\r\n"), [
    "Pixel_9_API_36",
    "Tablet_API_35",
  ]);
  assert.deepEqual(
    parseAdbDevices(
      "List of devices attached\r\nemulator-5554\tdevice\r\nABC123\toffline\r\n",
    ),
    [
      { serial: "emulator-5554", state: "device" },
      { serial: "ABC123", state: "offline" },
    ],
  );
});

test("passes an explicit Windows AVD home to emulator discovery without mutating env", async () => {
  for (const overrides of [
    {},
    { ANDROID_AVD_HOME: "D:\\Avds" },
    { ANDROID_USER_HOME: "D:\\AndroidUser" },
  ]) {
    const env = {
      USERPROFILE: "C:\\Users\\tester",
      ANDROID_HOME: "C:\\Android\\Sdk",
      ...overrides,
    };
    const expected =
      overrides.ANDROID_AVD_HOME ||
      path.win32.join(
        overrides.ANDROID_USER_HOME || "C:\\Users\\tester\\.android",
        "avd",
      );

    const service = createAndroidService({
      env,
      existsSync: () => true,
      execFileAsync: async (file, args, options) => {
        assert.equal(options.env.ANDROID_AVD_HOME, expected);
        return { stdout: "OrbitQA_Pixel_7_Real\n" };
      },
    });

    assert.deepEqual(await service.listAvds(), ["OrbitQA_Pixel_7_Real"]);
    assert.equal(env.ANDROID_AVD_HOME, overrides.ANDROID_AVD_HOME);
  }
});

test("rejects unsafe AVD names", () => {
  assert.equal(isSafeAvdName("Pixel_9_API_36"), true);
  assert.equal(isSafeAvdName("Pixel 9; calc.exe"), false);
  assert.equal(isSafeAvdName("../Pixel"), false);
});

test("leaves a plain AVD on the original cold-start argument list", () => {
  const { args, hardened } = buildAvdLaunchArgs("Pixel_9_API_36");
  assert.equal(hardened, false);
  assert.deepEqual(args, [
    "-avd",
    "Pixel_9_API_36",
    "-no-snapshot-load",
    "-no-boot-anim",
  ]);
});

test("adds -gpu host and retail -prop pairs for a hardened AVD", () => {
  const { args, hardened } = buildAvdLaunchArgs("OrbitQA_Pixel_7_Real");
  assert.equal(hardened, true);
  assert.deepEqual(args.slice(0, 4), [
    "-avd",
    "OrbitQA_Pixel_7_Real",
    "-no-snapshot-load",
    "-no-boot-anim",
  ]);
  assert.equal(args.includes("-gpu"), true);
  assert.equal(args[args.indexOf("-gpu") + 1], "host");
  assert.equal(args.includes("-prop"), true);
  const propValues = args.filter((_, index) => args[index - 1] === "-prop");
  assert.equal(
    propValues.some((value) => value === "ro.product.model=Pixel 7"),
    true,
  );
  const fingerprint = propValues.find((value) =>
    value.startsWith("ro.build.fingerprint="),
  );
  assert.ok(fingerprint && !/sdk_gphone|generic/.test(fingerprint));
});

test("keeps every fleet member hardened", () => {
  const name = fleetName("OrbitQA_Pixel_7_Real", 7);
  assert.equal(name, "OrbitQA_Pixel_7_Real_07");
  assert.equal(buildAvdLaunchArgs(name).hardened, true);
});

test("pads fleet indexes and respects the 64 character AVD name ceiling", () => {
  assert.equal(fleetName("OrbitQA_Pixel_7_Real", 1), "OrbitQA_Pixel_7_Real_01");
  assert.equal(
    fleetName("OrbitQA_Pixel_7_Real", 12),
    "OrbitQA_Pixel_7_Real_12",
  );
  const long = fleetName("B".repeat(80), 3);
  assert.equal(long.length, 64);
  assert.equal(long.endsWith("_03"), true);
  assert.equal(isSafeAvdName(long), true);
});

test("hardening props never leak into a non-matching AVD launch", async () => {
  const { service, calls } = createHarness({ avds: ["Pixel_9_API_36"] });
  await service.launchAvd("Pixel_9_API_36");

  const spawned = spawnCalls(calls);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].args.includes("-gpu"), false);
  assert.equal(spawned[0].args.includes("-prop"), false);
});

test("launches an AVD with argument arrays and never shell text", async () => {
  const { service, calls } = createHarness({ avds: ["Pixel_9_API_36"] });
  const result = await service.launchAvd("Pixel_9_API_36");

  assert.equal(result.state, "ready");
  const spawned = spawnCalls(calls);
  assert.deepEqual(spawned[0].args.slice(0, 2), ["-avd", "Pixel_9_API_36"]);
  assert.equal(spawned[0].options.shell, false);
});

test("launches a requested AVD even when a different emulator is already running", async () => {
  const { service, calls } = createHarness({
    avds: ["Pixel_A", "Pixel_B"],
    preAttached: [{ serial: "emulator-5554", state: "device" }],
    avdNameFor: (serial) =>
      serial === "emulator-5554" ? "Pixel_A" : "Pixel_B",
  });

  const result = await service.launchAvd("Pixel_B");

  assert.equal(result.serial, "emulator-5556");
  assert.equal(result.state, "ready");
  assert.equal(result.alreadyRunning, false);
  assert.equal(
    spawnCalls(calls).some((call) => call.args[1] === "Pixel_B"),
    true,
  );
});

test("recovers an offline emulator through ADB before spawning a duplicate", async () => {
  const { service, calls, flags } = createHarness({
    avds: ["Pixel_7_API_35"],
    devices: ({ recovered }) => [
      { serial: "emulator-5554", state: recovered ? "device" : "offline" },
    ],
  });

  const result = await service.launchAvd("Pixel_7_API_35");

  assert.equal(result.serial, "emulator-5554");
  assert.equal(result.alreadyRunning, true);
  assert.equal(spawnCalls(calls).length, 0);
  assert.equal(flags.recovered, true);
  assert.equal(
    calls.some(
      (call) => call.args[0] === "reconnect" && call.args[1] === "offline",
    ),
    true,
  );
});

test("reuse false starts a second instance of the same AVD on a free port", async () => {
  const { service, calls } = createHarness({ avds: ["Pixel_9_API_36"] });

  const first = await service.launchAvd("Pixel_9_API_36", { reuse: false });
  const second = await service.launchAvd("Pixel_9_API_36", { reuse: false });

  assert.equal(first.port % 2, 0);
  assert.equal(second.port % 2, 0);
  assert.notEqual(first.port, second.port);
  assert.equal(second.port - first.port, 2);
  assert.equal(spawnCalls(calls).length, 2);
});

test("concurrent launches never collide on a console port", async () => {
  const { service } = createHarness({ avds: ["Pixel_9_API_36"] });

  const results = await Promise.all([
    service.launchAvd("Pixel_9_API_36", { reuse: false }),
    service.launchAvd("Pixel_9_API_36", { reuse: false }),
    service.launchAvd("Pixel_9_API_36", { reuse: false }),
  ]);

  const ports = results.map((result) => result.port);
  assert.deepEqual([...new Set(ports)].length, 3);
  for (const port of ports) assert.equal(port % 2, 0);
});

test("launches the emulator in the foreground process model", async () => {
  const { service, calls } = createHarness({ avds: ["Pixel_7_API_35"] });
  await service.launchAvd("Pixel_7_API_35");

  const spawned = spawnCalls(calls);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].options.detached, false);
  assert.equal(spawned[0].options.stdio, "ignore");
  assert.equal(spawned[0].options.windowsHide, false);
});

test("fails fast with emulator startup diagnostics when the process exits", async () => {
  const { service } = createHarness({
    avds: ["Pixel_7_API_35"],
    devices: () => [],
    spawn: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.unref = () => {};
      setImmediate(() => {
        child.stderr.write("PANIC: broken AVD image");
        child.emit("exit", 1, null);
      });
      return child;
    },
    sleep: () => new Promise(() => {}),
  });

  await assert.rejects(
    () => service.launchAvd("Pixel_7_API_35"),
    /emulator process exited.*code 1/i,
  );
});

test("reports a boot timeout when the serial never attaches", async () => {
  const { service } = createHarness({
    avds: ["Pixel_7_API_35"],
    devices: () => [],
    getprop: "0",
  });

  await assert.rejects(
    () => service.launchAvd("Pixel_7_API_35"),
    /did not finish booting/i,
  );
});

test("launches Android AVD with cold-start-safe arguments", async () => {
  const { service, calls } = createHarness({ avds: ["Pixel_9_API_36"] });
  await service.launchAvd("Pixel_9_API_36");

  const spawned = spawnCalls(calls);
  assert.equal(spawned[0].args.includes("-no-snapshot-load"), true);
  assert.equal(spawned[0].args.includes("-no-boot-anim"), true);
});

test("getStatus matches the MobileStatus contract consumed by the renderer", async () => {
  const { service } = createHarness({ avds: ["Pixel_9_API_36"] });
  const status = await service.getStatus();

  assert.equal(typeof status.sdkPath, "string");
  assert.equal(status.emulatorAvailable, true);
  assert.equal(status.adbAvailable, true);
  assert.equal(Array.isArray(status.avds), true);
  assert.equal(Array.isArray(status.devices), true);
  assert.equal(Array.isArray(status.running), true);
  assert.equal(Array.isArray(status.runningSerials), true);
  assert.equal(typeof status.maxParallel, "number");
  assert.equal(status.error, null);
  assert.equal("sdkRoot" in status, false);
});

test("getStatus reports running emulators with their AVD name", async () => {
  const { service } = createHarness({
    avds: ["Pixel_A"],
    devices: () => [{ serial: "emulator-5554", state: "device" }],
    avdNameFor: () => "Pixel_A",
  });

  const status = await service.getStatus();
  assert.deepEqual(status.runningSerials, ["emulator-5554"]);
  assert.equal(status.running[0].avdName, "Pixel_A");
  assert.equal(status.devices[0].state, "device");
});

test("maxParallel is read from the environment and clamped", () => {
  const base = { existsSync: () => true };
  assert.equal(createAndroidService(base).maxParallel(), 20);
  assert.equal(
    createAndroidService({
      ...base,
      env: { ORBITQA_AVD_MAX_PARALLEL: "3" },
    }).maxParallel(),
    3,
  );
  assert.equal(
    createAndroidService({
      ...base,
      env: { ORBITQA_AVD_MAX_PARALLEL: "999" },
    }).maxParallel(),
    64,
  );
  assert.equal(
    createAndroidService({
      ...base,
      env: { ORBITQA_AVD_MAX_PARALLEL: "0" },
    }).maxParallel(),
    20,
  );
});

test("launchFleet creates missing members and clamps to maxParallel", async () => {
  const { service } = createHarness({ avds: ["Pixel_9_API_36"] });

  const fleet = await service.launchFleet({
    count: 3,
    ensure: false,
    env: undefined,
  });

  assert.equal(fleet.count, 3);
  assert.deepEqual(
    fleet.devices.map((device) => device.name),
    [
      "OrbitQA_Pixel_7_Real_01",
      "OrbitQA_Pixel_7_Real_02",
      "OrbitQA_Pixel_7_Real_03",
    ],
  );
  const ports = fleet.devices.map((device) => device.port);
  assert.equal([...new Set(ports)].length, 3);
});

test("launchFleet respects the parallel ceiling", async () => {
  const { service } = createHarness({
    avds: ["Pixel_9_API_36"],
    env: { ORBITQA_AVD_MAX_PARALLEL: "2" },
  });

  const fleet = await service.launchFleet({ count: 9, ensure: false });
  assert.equal(fleet.count, 2);
  assert.equal(fleet.devices.length, 2);
});

test("stop releases the reserved port so it can be reused", async () => {
  const { service } = createHarness({ avds: ["Pixel_9_API_36"] });

  const first = await service.launchAvd("Pixel_9_API_36", { reuse: false });
  await service.stopAvd(first.serial);
  const second = await service.launchAvd("Pixel_9_API_36", { reuse: false });

  assert.equal(second.port, first.port);
});
