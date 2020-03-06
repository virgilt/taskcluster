const DataLoader = require('dataloader');
const sift = require('../utils/sift');
const ConnectionLoader = require('../ConnectionLoader');

module.exports = ({ workerManager }) => {
  const Worker = new DataLoader(queries =>
    Promise.all(
      queries.map(({ workerPoolId, workerGroup, workerId }) => {
        return workerManager.worker(workerPoolId, workerGroup, workerId);
      }),
    ),
  );

  const WorkerPool = new DataLoader(queries =>
    Promise.all(
      queries.map(({ workerPoolId }) => {
        return workerManager.workerPool(workerPoolId);
      }),
    ),
  );

  const WorkerPools = new ConnectionLoader(
    async ({ filter, options }) => {
      const raw = await workerManager.listWorkerPools(options);
      const pools = sift(filter, raw.workerPools);

      return {
        ...raw,
        items: pools,
      };
    },
  );

  const Workers = new ConnectionLoader(
    async ({ workerPoolId, filter, options }) => {
      const raw = await workerManager.listWorkersForWorkerPool(workerPoolId, options);
      const workers = sift(filter, raw.workers);

      return {
        ...raw,
        items: workers,
      };
    },
  );

  const WorkerPoolErrors = new ConnectionLoader(
    async ({ workerPoolId, filter, options }) => {
      const raw = await workerManager.listWorkerPoolErrors(workerPoolId, options);
      const errors = sift(filter, raw.workerPoolErrors);

      return {
        ...raw,
        items: errors,
      };
    },
  );

  const Providers = new ConnectionLoader(
    async ({ filter, options }) => {
      const raw = await workerManager.listProviders(options);
      const providers = sift(filter, raw.providers);

      return {
        ...raw,
        items: providers,
      };
    },
  );

  return {
    Worker,
    Workers,
    WorkerPool,
    WorkerPools,
    Providers,
    WorkerPoolErrors,
  };
};
