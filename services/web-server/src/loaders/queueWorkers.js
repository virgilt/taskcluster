const DataLoader = require('dataloader');

module.exports = ({ queue }) => {
  const QueueWorker = new DataLoader(queries =>
    Promise.all(
      queries.map(async ({ provisionerId, workerType, workerGroup, workerId }) => {
        return queue.getWorker(provisionerId, workerType, workerGroup, workerId);
      }),
    ),
  );
  const QueueWorkerType = new DataLoader(queries =>
    Promise.all(
      queries.map(async ({ provisionerId, workerType }) => {
        return queue.getWorkerType(provisionerId, workerType);
      }),
    ),
  );
  const PendingTasks = new DataLoader(queries =>
    Promise.all(
      queries.map(async ({ provisionerId, workerType }) => {
        try {
          const { pendingTasks } = await queue.pendingTasks(
            provisionerId,
            workerType,
          );

          return pendingTasks;
        } catch (err) {
          return err;
        }
      }),
    ),
  );
  return {
    QueueWorker,
    QueueWorkerType,
    PendingTasks,
  };
};
