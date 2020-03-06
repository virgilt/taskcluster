const assert = require('assert');
const { ApolloClient } = require('apollo-client');
const { InMemoryCache } = require('apollo-cache-inmemory');
const { HttpLink } = require('apollo-link-http');
const fetch = require('node-fetch');
const gql = require('graphql-tag');
const testing = require('taskcluster-lib-testing');
const helper = require('../helper');
const providersQuery = require('../fixtures/providers.graphql');
const workerPoolQuery = require('../fixtures/workerPool.graphql');
const workerQuery = require('../fixtures/worker.graphql');
const workerPoolsQuery = require('../fixtures/workerPools.graphql');
const workerPoolErrorsQuery = require('../fixtures/workerPoolErrors.graphql');
const workerPoolWorkersQuery = require('../fixtures/workerPoolWorkers.graphql');
const createWorkerPoolMutation = require('../fixtures/createWorkerPool.graphql');
const createTaskQuery = require('../fixtures/createTask.graphql');

helper.secrets.mockSuite(testing.suiteName(), [], function(mock, skipping) {
  helper.withEntities(mock, skipping);
  helper.withClients(mock, skipping);
  helper.withServer(mock, skipping);

  let client;

  suiteSetup(function() {
    const cache = new InMemoryCache();
    const httpLink = new HttpLink({
      uri: `http://localhost:${helper.serverPort}/graphql`,
      fetch,
    });

    client = new ApolloClient({ cache, link: httpLink });
  });

  test('list providers', async function() {
    const response = await client.query({
      query: gql`${providersQuery}`,
    });

    assert.equal(response.data.providers.edges.length, 1);
    assert.equal(response.data.providers.edges[0].node.providerId, 'foo');
    assert.equal(response.data.providers.edges[0].node.providerType, 'bar');
  });

  test('get/list worker pools', async function() {
    await client.mutate({
      mutation: gql`${createWorkerPoolMutation}`,
      variables: {
        workerPoolId: 'foo/bar',
        payload: {
          providerId: 'baz',
          description: 'whatever',
          owner: 'foo@example.com',
          emailOnError: false,
          config: {},
        },
      },
    });

    await client.mutate({
      mutation: gql`${createWorkerPoolMutation}`,
      variables: {
        workerPoolId: 'baz/bing',
        payload: {
          providerId: 'wow',
          description: 'whatever',
          owner: 'foo@example.com',
          emailOnError: false,
          config: {},
        },
      },
    });

    const single = await client.query({
      query: gql`${workerPoolQuery}`,
      variables: {
        workerPoolId: 'baz/bing',
      },
    });

    assert.equal(single.data.workerPool.workerPoolId, 'baz/bing');
    assert.equal(single.data.workerPool.owner, 'foo@example.com');

    const response = await client.query({
      query: gql`${workerPoolsQuery}`,
    });

    assert.equal(response.data.workerPools.edges.length, 2);
    assert.equal(response.data.workerPools.edges[0].node.workerPoolId, 'foo/bar');
    assert.equal(response.data.workerPools.edges[1].node.workerPoolId, 'baz/bing');
    assert.equal(response.data.workerPools.edges[0].node.providerId, 'baz');
    assert.equal(response.data.workerPools.edges[1].node.providerId, 'wow');

    const clippedResponse = await client.query({
      query: gql`${workerPoolsQuery}`,
      variables: {
        connection: {
          limit: 1,
        },
      },
    });

    assert.equal(clippedResponse.data.workerPools.edges.length, 1);
    assert.equal(clippedResponse.data.workerPools.edges[0].node.workerPoolId, 'foo/bar');
    assert.equal(clippedResponse.data.workerPools.edges[0].node.providerId, 'baz');
  });

  test('list worker pool errors', async function() {
    await client.mutate({
      mutation: gql`${createWorkerPoolMutation}`,
      variables: {
        workerPoolId: 'whatever/name',
        payload: {
          providerId: 'wow',
          description: 'whatever',
          owner: 'foo@example.com',
          emailOnError: false,
          config: {},
        },
      },
    });

    const response = await client.query({
      query: gql`${workerPoolErrorsQuery}`,
      variables: {
        workerPoolId: 'whatever/name',
      },
    });
    assert.equal(response.data.workerPool.errors.edges[0].node.title, 'FOO');
  });

  test('list worker pool workers', async function() {
    await client.mutate({
      mutation: gql`${createWorkerPoolMutation}`,
      variables: {
        workerPoolId: 'whatever/name',
        payload: {
          providerId: 'wow',
          description: 'whatever',
          owner: 'foo@example.com',
          emailOnError: false,
          config: {},
        },
      },
    });

    const response = await client.query({
      query: gql`${workerPoolWorkersQuery}`,
      variables: {
        workerPoolId: 'whatever/name',
      },
    });
    assert.equal(response.data.workerPool.workers.edges[0].node.workerId, 'FOO');
  });

  test('get single worker', async function() {
    await client.mutate({
      mutation: gql`${createTaskQuery}`,
      variables: {
        taskId: 'XKi8QH-lRF-_gJWMD3IGFg',
        task: helper.makeTaskDefinition(),
      },
    });
    const single = await client.query({
      query: gql`${workerQuery}`,
      variables: {
        workerPoolId: 'baz/bing',
        workerGroup: 'something',
        workerId: 'FOO',
      },
    });

    assert.equal(single.data.worker.workerId, 'FOO');
    assert.equal(single.data.worker.recentTasks.length, 1);
    assert.equal(single.data.worker.recentTasks[0].runId, 0);
    assert(single.data.worker.quarantineUntil);
    assert(single.data.worker.queueDataExpires);
    assert(single.data.worker.firstClaim);
  });
});
