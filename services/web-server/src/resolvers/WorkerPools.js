const {splitWorkerPoolId} = require('../utils/workerPool');

module.exports = {
  LatestTask: {
    async run({ taskId, runId }, args, { loaders }) {
      const status = await loaders.status.load(taskId);

      return status.runs[runId];
    },
  },
  Worker: {
    async recentTasks({ workerPoolId, workerGroup, workerId }, args, { loaders }) {
      const { provisionerId, workerType } = splitWorkerPoolId(workerPoolId);
      const queueWorker = await loaders.QueueWorker.load({provisionerId, workerType, workerGroup, workerId});
      return Promise.all(queueWorker.recentTasks.map(async ({ taskId, runId }) => {
        return {
          taskId,
          runId,
          run: await loaders.task.load(taskId),
        };
      }));
    },
    async quarantineUntil({ workerPoolId, workerGroup, workerId }, args, { loaders }) {
      const { provisionerId, workerType } = splitWorkerPoolId(workerPoolId);
      const { quarantineUntil } = await loaders.QueueWorker.load({provisionerId, workerType, workerGroup, workerId});
      return quarantineUntil;
    },
    async firstClaim({ workerPoolId, workerGroup, workerId }, args, { loaders }) {
      const { provisionerId, workerType } = splitWorkerPoolId(workerPoolId);
      const { firstClaim } = await loaders.QueueWorker.load({provisionerId, workerType, workerGroup, workerId});
      return firstClaim;
    },
    async queueDataExpires({ workerPoolId, workerGroup, workerId }, args, { loaders }) {
      const { provisionerId, workerType } = splitWorkerPoolId(workerPoolId);
      const { expires } = await loaders.QueueWorker.load({provisionerId, workerType, workerGroup, workerId});
      return expires;
    },
  },
  WorkerPool: {
    pendingTasks({ workerPoolId }, args, { loaders }) {
      const { provisionerId, workerType } = splitWorkerPoolId(workerPoolId);
      return loaders.PendingTasks.load({
        provisionerId,
        workerType,
      });
    },
    async lastDateActive({ workerPoolId }, args, { loaders}) {
      const { provisionerId, workerType } = splitWorkerPoolId(workerPoolId);
      try {
        const wt = await loaders.QueueWorkerType.load({
          provisionerId,
          workerType,
        });
        return wt.lastDateActive;
      } catch (err) {
        if (err.statusCode !== 404) {
          throw err;
        }
        return undefined;
      }
    },
    async queueDataExpires({ workerPoolId }, args, { loaders }) {
      const { provisionerId, workerType } = splitWorkerPoolId(workerPoolId);
      try {
        const { expires } = await loaders.QueueWorkerType.load({provisionerId, workerType});
        return expires;
      } catch (err) {
        if (err.statusCode !== 404) {
          throw err;
        }
        return undefined;
      }
    },
    workers(
      { workerPoolId },
      { connection, filter },
      { loaders },
    ) {
      return loaders.Workers.load({
        workerPoolId,
        connection,
        filter,
      });
    },
    errors(
      { workerPoolId },
      { connection, filter },
      { loaders },
    ) {
      return loaders.WorkerPoolErrors.load({
        workerPoolId,
        connection,
        filter,
      });
    },
  },
  Query: {
    worker(parent, { workerPoolId, workerGroup, workerId }, { loaders }) {
      return loaders.Worker.load({ workerPoolId, workerGroup, workerId });
    },
    workerPool(parent, { workerPoolId }, { loaders }) {
      return loaders.WorkerPool.load({ workerPoolId });
    },
    workerPools(parent, { connection, filter }, { loaders }) {
      return loaders.WorkerPools.load({ connection, filter });
    },
    providers(parent, { connection, filter }, { loaders }) {
      return loaders.Providers.load({ connection, filter });
    },
  },
  Mutation: {
    createWorkerPool(parent, { workerPoolId, payload }, { clients} ) {
      return clients.workerManager.createWorkerPool(workerPoolId, payload);
    },
    updateWorkerPool(parent, { workerPoolId, payload }, { clients} ) {
      return clients.workerManager.updateWorkerPool(workerPoolId, payload);
    },
    quarantineWorker(
      parent,
      { workerPoolId, workerGroup, workerId, payload },
      { clients },
    ) {
      const { provisionerId, workerType } = splitWorkerPoolId(workerPoolId);
      return clients.queue.quarantineWorker(
        provisionerId,
        workerType,
        workerGroup,
        workerId,
        payload,
      );
    },
  },
};
