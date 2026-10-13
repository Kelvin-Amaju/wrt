const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;

function recoveryFailure(filePath, reason) {
  const runId = path.basename(filePath, '.json');
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    summary: {
      runId,
      runKind: 'qa',
      createdAt: now,
      updatedAt: now,
      status: 'FAILED',
      executionMode: 'visible',
      requestedConcurrency: 1,
      targetSummary: 'Recovered run record',
      deviceFamilies: [],
      counters: { requested: 0, running: 0, queued: 0, completed: 0, failed: 1, cancelled: 0, incomplete: 0 },
      resourceMessage: `Run recovery failed: ${reason}`,
    },
    config: null,
    checkpoint: { nextWorkOrdinal: 0, terminalWorkIds: [], inFlightWorkIds: [] },
    logs: [],
    results: {},
    lastCheckpointAt: now,
  };
}

function createRunStore({ userDataPath }) {
  const dir = path.join(userDataPath, 'run-center');
  fs.mkdirSync(dir, { recursive: true });

  function fileFor(runId) { return path.join(dir, `${runId}.json`); }

  function save(record) {
    if (!record?.summary?.runId) throw new Error('Run record must include summary.runId');
    const finalPath = fileFor(record.summary.runId);
    const tempPath = `${finalPath}.tmp`;
    const payload = JSON.stringify({ ...record, schemaVersion: SCHEMA_VERSION }, null, 2);
    const fd = fs.openSync(tempPath, 'w');
    try {
      fs.writeFileSync(fd, payload, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, finalPath);
    return record;
  }

  function readPath(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed?.schemaVersion !== SCHEMA_VERSION) throw new Error(`unsupported schema version ${parsed?.schemaVersion}`);
    if (!parsed?.summary?.runId) throw new Error('missing summary.runId');
    return parsed;
  }

  function get(runId) {
    const filePath = fileFor(runId);
    if (!fs.existsSync(filePath)) return null;
    return readPath(filePath);
  }

  function list() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => readPath(path.join(dir, name)));
  }

  function loadRecoverable() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        const filePath = path.join(dir, name);
        try { return readPath(filePath); }
        catch (error) { return recoveryFailure(filePath, error instanceof Error ? error.message : String(error)); }
      });
  }

  function remove(runId) {
    const filePath = fileFor(runId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  return { dir, save, get, list, remove, loadRecoverable };
}

module.exports = { createRunStore, SCHEMA_VERSION };
