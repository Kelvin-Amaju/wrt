const os = require('node:os');

const MEMORY_PER_WORKER_BYTES = 768 * 1024 * 1024;
const PAUSE_FREE_MEMORY_FRACTION = 0.10;
const RESUME_FREE_MEMORY_FRACTION = 0.18;
const PAUSE_CPU_LOAD = 0.92;
const RESUME_CPU_LOAD = 0.78;

let previousCpuSample = null;

function readCpuSample() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times || {};
    const values = [times.user, times.nice, times.sys, times.idle, times.irq].map((value) => Number(value) || 0);
    idle += values[3];
    total += values.reduce((sum, value) => sum + value, 0);
  }
  return { idle, total, logicalCpuCount: Math.max(1, cpus.length || 1) };
}

function getResourceSnapshot() {
  const current = readCpuSample();
  let cpuLoadFraction = 0;
  if (previousCpuSample) {
    const totalDelta = Math.max(0, current.total - previousCpuSample.total);
    const idleDelta = Math.max(0, current.idle - previousCpuSample.idle);
    if (totalDelta > 0) cpuLoadFraction = Math.min(1, Math.max(0, 1 - (idleDelta / totalDelta)));
  }
  previousCpuSample = current;
  return {
    freeMemoryBytes: os.freemem(),
    totalMemoryBytes: os.totalmem(),
    cpuLoadFraction,
    logicalCpuCount: current.logicalCpuCount,
  };
}

function computeAutoConcurrency(snapshot = {}) {
  const logicalCpuCount = Math.max(1, Number(snapshot.logicalCpuCount) || 1);
  const freeMemoryBytes = Math.max(0, Number(snapshot.freeMemoryBytes) || 0);
  const cpuWorkers = Math.max(1, Math.floor(Math.max(1, logicalCpuCount - 1) / 2));
  const memoryWorkers = Math.max(1, Math.floor(freeMemoryBytes / MEMORY_PER_WORKER_BYTES));
  return Math.max(1, Math.min(cpuWorkers, memoryWorkers));
}

function freeMemoryFraction(snapshot = {}) {
  const total = Math.max(1, Number(snapshot.totalMemoryBytes) || 1);
  return Math.max(0, Math.min(1, (Number(snapshot.freeMemoryBytes) || 0) / total));
}

function isLaunchPaused(snapshot = {}) {
  return freeMemoryFraction(snapshot) <= PAUSE_FREE_MEMORY_FRACTION
    || (Number(snapshot.cpuLoadFraction) || 0) >= PAUSE_CPU_LOAD;
}

function isLaunchResumable(snapshot = {}) {
  return freeMemoryFraction(snapshot) >= RESUME_FREE_MEMORY_FRACTION
    && (Number(snapshot.cpuLoadFraction) || 0) <= RESUME_CPU_LOAD;
}

module.exports = {
  MEMORY_PER_WORKER_BYTES,
  PAUSE_FREE_MEMORY_FRACTION,
  RESUME_FREE_MEMORY_FRACTION,
  PAUSE_CPU_LOAD,
  RESUME_CPU_LOAD,
  getResourceSnapshot,
  computeAutoConcurrency,
  isLaunchPaused,
  isLaunchResumable,
};
