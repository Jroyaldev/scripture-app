// Concurrency primitives shared by the /magic browser and server.
// No Node imports: this module is safe on either side of the lab boundary.

export function retireOwnedDirectorEntry(cache, key, entry) {
  if (cache.get(key) !== entry) return false;
  cache.delete(key);
  return true;
}

export function createSharedDirectorJobs({ maxCompleted = 24 } = {}) {
  const inflight = new Map();
  const completed = new Map();

  const remember = (key, value) => {
    completed.delete(key);
    completed.set(key, value);
    while (completed.size > maxCompleted) {
      completed.delete(completed.keys().next().value);
    }
  };

  const acquire = (key, create) => {
    if (completed.has(key)) {
      const value = completed.get(key);
      remember(key, value);
      return {
        promise: Promise.resolve(value),
        release() {},
        cacheState: 'completed',
      };
    }

    let job = inflight.get(key);
    let cacheState = 'inflight';
    if (job?.controller.signal.aborted) {
      inflight.delete(key);
      job = null;
    }
    if (!job) {
      cacheState = 'miss';
      const controller = new AbortController();
      job = { controller, consumers: new Set(), settled: false, promise: null };
      job.promise = Promise.resolve()
        .then(() => create(controller.signal))
        .then((value) => {
          remember(key, value);
          return value;
        })
        .finally(() => {
          job.settled = true;
          if (inflight.get(key) === job) inflight.delete(key);
        });
      inflight.set(key, job);
    }

    const consumer = Symbol(key);
    job.consumers.add(consumer);
    let released = false;
    return {
      promise: job.promise,
      cacheState,
      release() {
        if (released) return;
        released = true;
        job.consumers.delete(consumer);
        if (!job.settled && job.consumers.size === 0) job.controller.abort();
      },
    };
  };

  return {
    acquire,
    sizes: () => ({ inflight: inflight.size, completed: completed.size }),
  };
}
