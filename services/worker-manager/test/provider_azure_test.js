const _ = require('lodash');
const taskcluster = require('taskcluster-client');
const sinon = require('sinon');
const assert = require('assert');
const helper = require('./helper');
const {FakeAzure} = require('./fakes');
const {AzureProvider} = require('../src/providers/azure');
const testing = require('taskcluster-lib-testing');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');
const {WorkerPool, Worker} = require('../src/data');
const Debug = require('debug');

const debug = Debug('provider_azure_test');

helper.secrets.mockSuite(testing.suiteName(), ['db'], function(mock, skipping) {
  helper.withDb(mock, skipping);
  helper.withEntities(mock, skipping);
  helper.withPulse(mock, skipping);
  helper.withFakeQueue(mock, skipping);
  helper.withFakeNotify(mock, skipping);
  helper.resetTables(mock, skipping);

  let provider;
  let providerId = 'azure';
  let workerPoolId = 'foo/bar';

  const fake = new FakeAzure();
  fake.forSuite();

  let baseProviderData = {
    location: 'westus',
    resourceGroupName: 'rgrp',
    vm: {
      name: 'some vm',
    },
    disks: [{
      name: 'some disk',
    }],
    nic: {
      name: 'some nic',
    },
    ip: {
      name: 'some ip',
    },
  };

  let monitor;
  suiteSetup(async function() {
    monitor = await helper.load('monitor');
  });

  setup(async function() {
    provider = new AzureProvider({
      providerId,
      notify: await helper.load('notify'),
      db: helper.db,
      monitor: (await helper.load('monitor')).childMonitor('azure'),
      estimator: await helper.load('estimator'),
      rootUrl: helper.rootUrl,
      WorkerPoolError: helper.WorkerPoolError,
      providerConfig: {
        clientId: 'my client id',
        secret: 'my secret',
        domain: 'some azure domain',
        subscriptionId: 'a subscription id',
        resourceGroupName: 'rgrp',
        storageAccountName: 'storage123',
        _backoffDelay: 1,
      },
    });

    // So that checked-in certs are still valid
    provider._now = () => taskcluster.fromNow('-10 years');

    await helper.db.fns.delete_worker_pool(workerPoolId);

    await provider.setup();
  });

  const makeWorkerPool = async (overrides = {}) => {
    let workerPool = WorkerPool.fromApi({
      workerPoolId,
      providerId,
      description: 'none',
      previousProviderIds: [],
      created: new Date(),
      lastModified: new Date(),
      config: {
        minCapacity: 1,
        maxCapacity: 1,
        lifecycle: {
          registrationTimeout: 6000,
        },
        launchConfigs: [
          {
            capacityPerInstance: 1,
            subnetId: 'some/subnet',
            location: 'westus',
            hardwareProfile: {
              vmSize: 'Basic_A2',
            },
            storageProfile: {
              osDisk: {},
              dataDisks: [{}],
            },
          },
        ],
      },
      owner: 'whatever@example.com',
      providerData: {},
      emailOnError: false,
      ...overrides,
    });
    await workerPool.create(helper.db);

    return workerPool;
  };

  const clientForResourceType = resourceType => {
    return {
      ip: fake.networkClient.publicIPAddresses,
      nic: fake.networkClient.networkInterfaces,
      disks: fake.computeClient.disks,
      vm: fake.computeClient.virtualMachines,
    }[resourceType];
  };

  suite('provisioning', function() {
    const provisionWorkerPool = async (launchConfig, overrides) => {
      const workerPool = await makeWorkerPool({
        config: {
          minCapacity: 1,
          maxCapacity: 1,
          launchConfigs: [{
            capacityPerInstance: 1,
            subnetId: 'some/subnet',
            location: 'westus',
            hardwareProfile: {vmSize: 'Basic_A2'},
            storageProfile: {
              osDisk: {},
            },
            ...launchConfig,
          }],
          ...overrides,
        },
        owner: 'whatever@example.com',
        providerData: {},
        emailOnError: false,
      });
      const workerInfo = {
        existingCapacity: 0,
        requestedCapacity: 0,
      };
      await provider.provision({workerPool, workerInfo});
      const workers = await Worker.getWorkers(helper.db, {});
      assert.equal(workers.rows.length, 1);
      const worker = workers.rows[0];

      // check that the VM config is correct since this suite does not
      // go all the way to creating the VM
      const config = {
        ...worker.providerData.vm.config,
        osProfile: {
          ...worker.providerData.vm.config.osProfile,
          adminUsername: 'user',
          adminPassword: 'pass',
        },
        tags: worker.providerData.tags,
      };
      fake.validate(config, 'azure-vm.yml');

      return worker;
    };

    test('provision a simple worker', async function() {
      const worker = await provisionWorkerPool({});

      assert.equal(worker.workerPoolId, workerPoolId);
      assert.equal(worker.providerId, 'azure');
      assert.equal(worker.workerGroup, 'westus');
      assert.equal(worker.state, 'requested');
      assert.equal(worker.capacity, 1);

      const providerData = worker.providerData;

      // Check that this is setting default times correctly to within a second
      // or so to allow for some time for the provisioning loop
      assert(providerData.terminateAfter - Date.now() - 345600000 < 5000);
      assert.equal(providerData.reregistrationTimeout, 345600000);

      assert.equal(providerData.location, 'westus');
      assert.equal(providerData.resourceGroupName, 'rgrp');
      assert.equal(providerData.workerConfig, undefined);
      assert.equal(providerData.tags['created-by'], 'taskcluster-wm-' + providerId);
      assert.equal(providerData.tags['managed-by'], 'taskcluster');
      assert.equal(providerData.tags['provider-id'], providerId);
      assert.equal(providerData.tags['worker-group'], 'westus');
      assert.equal(providerData.tags['worker-pool-id'], workerPoolId);
      assert.equal(providerData.tags['root-url'], helper.rootUrl);
      assert.equal(providerData.tags['owner'], 'whatever@example.com');

      const customData = JSON.parse(Buffer.from(providerData.vm.config.osProfile.customData, 'base64'));
      assert.equal(customData.workerPoolId, workerPoolId);
      assert.equal(customData.providerId, providerId);
      assert.equal(customData.workerGroup, 'westus');
      assert.equal(customData.rootUrl, helper.rootUrl);
      assert.deepEqual(customData.workerConfig, {});
    });

    test('provision with custom tags', async function() {
      const worker = await provisionWorkerPool({
        tags: {mytag: 'myvalue'},
      });
      assert.equal(worker.providerData.tags['mytag'], 'myvalue');
    });

    test('provision with lifecycle', async function() {
      const worker = await provisionWorkerPool({}, {
        lifecycle: {
          registrationTimeout: 6,
          reregistrationTimeout: 6,
        },
      });
      assert(worker.providerData.terminateAfter - Date.now() - 6000 < 5000);
      assert.equal(worker.providerData.reregistrationTimeout, 6000);
    });

    test('provision with custom tags named after built-in tags', async function() {
      const worker = await provisionWorkerPool({
        tags: {'created-by': 'me!'},
      });
      assert.equal(worker.providerData.tags['created-by'], 'taskcluster-wm-' + providerId);
    });

    test('provision with workerConfig', async function() {
      const worker = await provisionWorkerPool({
        workerConfig: {runTasksFaster: true},
      });
      assert.equal(worker.providerData.workerConfig.runTasksFaster, true);
    });

    test('provision with named disks ignores names', async function() {
      const worker = await provisionWorkerPool({
        storageProfile: {
          osDisk: {
            name: 'my_os_disk',
            testProperty: 1,
          },
          dataDisks: [{
            name: 'my_data_disk',
            testProperty: 2,
          }],
        },
      });
      const vmConfig = worker.providerData.vm.config;
      assert.notEqual(vmConfig.storageProfile.osDisk.name, 'my_os_disk');
      assert.equal(vmConfig.storageProfile.osDisk.testProperty, 1);
      assert.notEqual(vmConfig.storageProfile.dataDisks[0].name, 'my_os_disk');
      assert.equal(vmConfig.storageProfile.dataDisks[0].testProperty, 2);
    });

    test('provision with several osDisks', async function() {
      const worker = await provisionWorkerPool({
        storageProfile: {
          osDisk: {
            testProperty: 1,
          },
          dataDisks: [
            {
              testProperty: 2,
            },
            {
              testProperty: 3,
            },
            {
              testProperty: 4,
            },
            {
              testProperty: 5,
            },
          ],
        },
      });
      const vmConfig = worker.providerData.vm.config;
      assert.equal(vmConfig.storageProfile.osDisk.testProperty, 1);
      assert.equal(vmConfig.storageProfile.dataDisks[0].testProperty, 2);
      assert.equal(vmConfig.storageProfile.dataDisks[1].testProperty, 3);
      assert.equal(vmConfig.storageProfile.dataDisks[2].testProperty, 4);
      assert.equal(vmConfig.storageProfile.dataDisks[3].testProperty, 5);
    });

    test('provision with extra azure profiles', async function() {
      const worker = await provisionWorkerPool({
        billingProfile: {
          maxPrice: 10,
        },
        osProfile: {
          testProperty: 1,
        },
        storageProfile: {
          testProperty: 2,
          osDisk: {
            testProperty: 3,
          },
          dataDisks: [],
        },
        networkProfile: {
          testProperty: 4,
        },
      });
      const vmConfig = worker.providerData.vm.config;
      assert.equal(vmConfig.billingProfile.maxPrice, 10);
      assert.equal(vmConfig.osProfile.testProperty, 1);
      assert(vmConfig.osProfile.computerName); // still set..
      assert.equal(vmConfig.storageProfile.testProperty, 2);
      assert.equal(vmConfig.storageProfile.osDisk.testProperty, 3);
      assert.equal(vmConfig.networkProfile.testProperty, 4);
      assert(vmConfig.networkProfile.networkInterfaces); // still set..
    });
  });

  suite('provisionResources', function() {
    let worker, ipName, nicName, vmName;
    const sandbox = sinon.createSandbox({});

    setup('create un-provisioned worker', async function() {
      const workerPool = await makeWorkerPool();
      const workerInfo = {
        existingCapacity: 0,
        requestedCapacity: 0,
      };
      await provider.provision({workerPool, workerInfo});
      const workers = await Worker.getWorkers(helper.db, {});
      assert.equal(workers.rows.length, 1);
      worker = workers.rows[0];

      ipName = worker.providerData.ip.name;
      nicName = worker.providerData.nic.name;
      vmName = worker.providerData.vm.name;

      // stub for removeWorker, for failure cases
      sandbox.stub(provider, 'removeWorker').returns('stopped');

      // reset the state of the provisioner such that we can call its
      // scanning-related methods
      await provider.scanPrepare();
      provider.errors[workerPoolId] = [];
    });

    teardown(function() {
      sandbox.restore();
    });

    const assertProvisioningState = async (expectations) => {
      // re-fetch the worker, since it should have been updated
      const workers = await Worker.getWorkers(helper.db, {});
      assert.equal(workers.rows.length, 1);
      worker = workers.rows[0];

      for (let resourceType of ['ip', 'vm', 'nic']) {
        const name = worker.providerData[resourceType].name;
        switch (expectations[resourceType]) {
          case 'none':
            assert(!worker.providerData[resourceType].operation);
            assert(!worker.providerData[resourceType].id);
            break;
          case 'inprogress':
            assert.equal(worker.providerData[resourceType].operation, `op/${resourceType}/rgrp/${name}`);
            assert(!worker.providerData[resourceType].id);
            break;
          case 'allocated':
            assert(!worker.providerData[resourceType].operation);
            assert.equal(worker.providerData[resourceType].id, `id/${name}`);
            break;
          case undefined: // caller doesn't care about state of this resource
            break;
          default:
            assert(false, `invalid expectation ${resourceType}: ${expectations[resourceType]}`);
        }
      }
    };

    test('successful provisioning process', async function() {
      await assertProvisioningState({ip: 'none'});
      const ipName = worker.providerData.ip.name;
      const nicName = worker.providerData.nic.name;
      const vmName = worker.providerData.vm.name;

      debug('first call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'inprogress'});
      const ipParams = fake.networkClient.publicIPAddresses.getFakeRequestParameters('rgrp', ipName);
      assert.equal(ipParams.location, 'westus');
      assert.equal(ipParams.publicIPAllocationMethod, 'Dynamic');

      debug('second call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'inprogress'});

      debug('IP creation finishes');
      fake.networkClient.publicIPAddresses.fakeFinishRequest('rgrp', ipName);

      debug('third call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'allocated', nic: 'inprogress'});
      const nicParams = fake.networkClient.networkInterfaces.getFakeRequestParameters('rgrp', nicName);
      assert.equal(nicParams.location, 'westus');
      assert.deepEqual(nicParams.ipConfigurations, [
        {
          name: nicName,
          privateIPAllocationMethod: 'Dynamic',
          subnet: {id: 'some/subnet'},
          publicIPAddress: {id: worker.providerData.ip.id},
        },
      ]);

      debug('fourth call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'allocated', nic: 'inprogress'});

      debug('NIC creation finishes');
      fake.networkClient.networkInterfaces.fakeFinishRequest('rgrp', nicName);

      debug('fifth call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({nic: 'allocated', vm: 'inprogress'});
      const vmParams = fake.computeClient.virtualMachines.getFakeRequestParameters('rgrp', vmName);
      assert(!vmParams.capacityPerInstance);
      assert.equal(vmParams.location, 'westus');
      assert.deepEqual(vmParams.hardwareProfile, {vmSize: 'Basic_A2'});
      // these must be set, but we don't care to what..
      assert(vmParams.osProfile.computerName);
      assert(vmParams.osProfile.adminUsername);
      assert(vmParams.osProfile.adminPassword);

      const customData = JSON.parse(Buffer.from(vmParams.osProfile.customData, 'base64'));
      assert.equal(customData.workerPoolId, workerPoolId);
      assert.equal(customData.providerId, providerId);
      assert.equal(customData.workerGroup, 'westus');
      assert.equal(customData.rootUrl, helper.rootUrl);
      assert.deepEqual(customData.workerConfig, {});

      assert.deepEqual(vmParams.networkProfile.networkInterfaces, [
        {
          id: worker.providerData.nic.id,
          primary: true,
        },
      ]);
      assert.equal(vmParams.tags['created-by'], 'taskcluster-wm-' + providerId);
      assert.equal(vmParams.tags['managed-by'], 'taskcluster');
      assert.equal(vmParams.tags['provider-id'], providerId);
      assert.equal(vmParams.tags['worker-group'], 'westus');
      assert.equal(vmParams.tags['worker-pool-id'], workerPoolId);
      assert.equal(vmParams.tags['root-url'], helper.rootUrl);
      assert.equal(vmParams.tags['owner'], 'whatever@example.com');

      debug('sixth call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({nic: 'allocated', vm: 'inprogress'});

      debug('VM creation finishes');
      fake.computeClient.virtualMachines.fakeFinishRequest('rgrp', vmName);

      debug('seventh call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({nic: 'allocated', vm: 'allocated'});

      assert(!provider.removeWorker.called);
    });

    test('provisioning process fails creating IP', async function() {
      await assertProvisioningState({ip: 'none'});

      debug('first call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'inprogress'});

      debug('IP creation fails');
      fake.networkClient.publicIPAddresses.fakeFailRequest('rgrp', ipName, 'uhoh');

      debug('second call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'none', nic: 'none'});
      assert(provider.removeWorker.called);
    });

    test('provisioning process fails creating IP with provisioningState=Failed', async function() {
      await assertProvisioningState({ip: 'none'});

      debug('first call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'inprogress'});

      debug('IP creation fails');
      fake.networkClient.publicIPAddresses.fakeFinishRequest('rgrp', ipName);
      fake.networkClient.publicIPAddresses.modifyFakeResource('rgrp', ipName, res => {
        res.provisioningState = 'Failed';
      });

      debug('second call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'none', nic: 'none'});
      assert(provider.removeWorker.called);
    });

    test('provisioning process fails creating NIC', async function() {
      await assertProvisioningState({ip: 'none'});

      debug('first call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'inprogress'});

      debug('IP creation succeeds');
      fake.networkClient.publicIPAddresses.fakeFinishRequest('rgrp', ipName);

      debug('second call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'allocated', nic: 'inprogress'});

      debug('NIC creation fails');
      fake.networkClient.networkInterfaces.fakeFailRequest('rgrp', nicName, 'uhoh');

      debug('third call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'allocated', nic: 'none'});
      assert(provider.removeWorker.called);
    });

    test('provisioning process fails creating VM', async function() {
      await assertProvisioningState({ip: 'none'});

      debug('first call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'inprogress'});

      debug('IP creation succeeds');
      fake.networkClient.publicIPAddresses.fakeFinishRequest('rgrp', ipName);

      debug('second call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'allocated', nic: 'inprogress'});

      debug('NIC creation succeeds');
      fake.networkClient.networkInterfaces.fakeFinishRequest('rgrp', nicName);

      debug('third call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'allocated', nic: 'allocated', vm: 'inprogress'});

      debug('VM creation fails');
      fake.computeClient.virtualMachines.fakeFailRequest('rgrp', vmName, 'uhoh');

      debug('fourth call');
      await provider.provisionResources({worker, monitor});
      await assertProvisioningState({ip: 'allocated', nic: 'allocated', vm: 'none'});
      assert(provider.removeWorker.called);
    });
  });

  suite('removeWorker', function() {
    let worker, ipName, nicName, vmName;
    setup('create un-provisioned worker', async function() {
      const workerPool = await makeWorkerPool();
      const workerInfo = {
        existingCapacity: 0,
        requestedCapacity: 0,
      };
      await provider.provision({workerPool, workerInfo});
      const workers = await Worker.getWorkers(helper.db, {});
      assert.equal(workers.rows.length, 1);
      worker = workers.rows[0];

      ipName = worker.providerData.ip.name;
      nicName = worker.providerData.nic.name;
      vmName = worker.providerData.vm.name;
    });

    const assertRemovalState = async (expectations) => {
      // re-fetch the worker, since it should have been updated
      const workers = await Worker.getWorkers(helper.db, {});
      assert.equal(workers.rows.length, 1);
      worker = workers.rows[0];

      let checkResourceExpectation = (expectation, resourceType, typeData, index) => {
        const client = clientForResourceType(resourceType);
        switch (expectation) {
          case 'none':
            assert(!typeData.id);
            assert.deepEqual(client.getFakeResource('rgrp', typeData.name), undefined);
            break;
          case 'deleting':
            assert(!typeData.id);
            assert.equal(client.getFakeResource('rgrp', typeData.name).provisioningState, 'Deleting');
            break;
          case 'allocated':
            assert.equal(typeData.id, `id/${typeData.name}`);
            assert.equal(client.getFakeResource('rgrp', typeData.name).provisioningState, 'Succeeded');
            break;
          case undefined: // caller doesn't care about state of this resource
            break;
          default:
            if (index !== undefined) {
              assert(false, `invalid expectation ${resourceType} ${index}: ${expectation}`);
            } else {
              assert(false, `invalid expectation ${resourceType}: ${expectation}`);
            }
        }
      };
      for (let resourceType of ['ip', 'vm', 'nic', 'disks']) {
        // multiple of a resource type
        if (Array.isArray(worker.providerData[resourceType])) {
          for (let i = 0; i < worker.providerData[resourceType].length; i++) {
            checkResourceExpectation(
              expectations[resourceType][i],
              resourceType,
              worker.providerData[resourceType][i],
              i,
            );
          }
        } else {
          checkResourceExpectation(
            expectations[resourceType],
            resourceType,
            worker.providerData[resourceType],
          );
        }
      }
    };

    const makeResource = async (resourceType, gotId, index = undefined) => {
      let name;
      if (index !== undefined) {
        // default name for unnamed multiple resources in arrays
        name = `${resourceType}${index}`;
      } else {
        name = worker.providerData[resourceType].name;
      }
      const client = clientForResourceType(resourceType);
      const res = client.makeFakeResource('rgrp', name);
      // disks start out as [] in providerData
      // mock getting disk info back from azure on VM GET
      if (index !== undefined) {
        await worker.update(helper.db, worker => {
          while (worker.providerData[resourceType].length <= index) {
            worker.providerData[resourceType].push({});
          }
          worker.providerData[resourceType][index].name = name;
        });
      }
      if (gotId) {
        if (index !== undefined) {
          await worker.update(helper.db, worker => {
            worker.providerData[resourceType][index].id = res.id;
          });
        } else {
          await worker.update(helper.db, worker => {
            worker.providerData[resourceType].id = res.id;
          });
        }
      }
    };

    test('full removeWorker process', async function() {
      await makeResource('ip', true);
      await makeResource('nic', true);
      await makeResource('disks', true, 0); // creates disks0
      await makeResource('disks', true, 1); // creates disks1
      await makeResource('vm', true);
      await worker.update(helper.db, worker => {
        worker.state = 'running';
      });
      await assertRemovalState({ip: 'allocated', nic: 'allocated', disks: ['allocated', 'allocated'], vm: 'allocated'});

      debug('first call');
      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({ip: 'allocated', nic: 'allocated', disks: ['allocated', 'allocated'], vm: 'deleting'});

      debug('second call');
      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({ip: 'allocated', nic: 'allocated', disks: ['allocated', 'allocated'], vm: 'deleting'});

      debug('VM deleted');
      await fake.computeClient.virtualMachines.fakeFinishRequest('rgrp', vmName);

      debug('third call');
      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({ip: 'allocated', nic: 'deleting', disks: ['allocated', 'allocated'], vm: 'none'});

      debug('fourth call');
      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({ip: 'allocated', nic: 'deleting', disks: ['allocated', 'allocated'], vm: 'none'});

      debug('NIC deleted');
      await fake.networkClient.networkInterfaces.fakeFinishRequest('rgrp', nicName);

      debug('fifth call');
      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({ip: 'deleting', nic: 'none', disks: ['allocated', 'allocated'], vm: 'none'});

      debug('sixth call');
      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({ip: 'deleting', nic: 'none', disks: ['allocated', 'allocated'], vm: 'none'});

      debug('IP deleted');
      await fake.networkClient.publicIPAddresses.fakeFinishRequest('rgrp', ipName);

      debug('seventh call');
      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({ip: 'none', nic: 'none', disks: ['deleting', 'deleting'], vm: 'none'});

      debug('eighth call');
      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({ip: 'none', nic: 'none', disks: ['deleting', 'deleting'], vm: 'none'});

      debug('disks0 deleted');
      await fake.computeClient.disks.fakeFinishRequest('rgrp', 'disks0');

      debug('ninth call');
      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({ip: 'none', nic: 'none', disks: ['none', 'deleting'], vm: 'none'});

      debug('disks1 deleted');
      await fake.computeClient.disks.fakeFinishRequest('rgrp', 'disks1');

      debug('tenth call');
      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({ip: 'none', nic: 'none', disks: ['none', 'none'], vm: 'none'});
      assert.equal(worker.state, 'stopped');
    });

    test('vm removal fails (keeps waiting)', async function() {
      await makeResource('ip', true);
      await makeResource('nic', true);
      await makeResource('disks', true, 0);
      await makeResource('vm', true);
      await worker.update(helper.db, worker => {
        worker.state = 'running';
      });

      debug('first call');
      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({ip: 'allocated', nic: 'allocated', disks: ['allocated'], vm: 'deleting'});

      debug('removal fails');
      await fake.computeClient.virtualMachines.fakeFailRequest('rgrp', vmName, 'uhoh');

      debug('second call');
      await provider.removeWorker({worker, reason: 'test'});
      // removeWorker doesn't care, keeps waiting
      await assertRemovalState({ip: 'allocated', nic: 'allocated', disks: ['allocated'], vm: 'deleting'});
    });

    test('deletes VM by name if id is missing', async function() {
      await makeResource('ip', true);
      await makeResource('nic', true);
      await makeResource('disks', true, 0);
      await makeResource('vm', false);
      await worker.update(helper.db, worker => {
        worker.state = 'running';
      });

      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({ip: 'allocated', nic: 'allocated', disks: ['allocated'], vm: 'deleting'});

      // check that there's a request to delete the VM (by name)
      assert.deepEqual(await fake.computeClient.virtualMachines.getFakeRequestParameters('rgrp', vmName), {});
    });

    test('deletes disk by name if no VM/IP/NIC and disk id is missing', async function() {
      await makeResource('disks', false, 0);
      const diskName = worker.providerData.disks[0].name;

      await worker.update(helper.db, worker => {
        worker.providerData.disks[0].id = undefined;
        worker.state = 'running';
      });

      await provider.removeWorker({worker, reason: 'test'});
      await assertRemovalState({disks: ['deleting']});

      // check that there's a request to delete the disk (by name)
      assert.deepEqual(await fake.computeClient.disks.getFakeRequestParameters('rgrp', diskName), {});
    });
  });

  test('de-provisioning loop', async function() {
    const workerPool = await makeWorkerPool({
      // simulate previous provisionig and deleting the workerpool
      providerId: 'null-provider',
      previousProviderIds: ['azure'],
    });
    await provider.deprovision({workerPool});
    // nothing has changed..
    assert(workerPool.previousProviderIds.includes('azure'));
  });

  suite('checkWorker', function() {
    let worker;
    const sandbox = sinon.createSandbox({});
    setup('set up for checkWorker', async function() {
      await provider.scanPrepare();

      worker = Worker.fromApi({
        workerPoolId,
        workerGroup: 'westus',
        workerId: 'whatever',
        providerId,
        created: taskcluster.fromNow('0 seconds'),
        lastModified: taskcluster.fromNow('0 seconds'),
        lastChecked: taskcluster.fromNow('0 seconds'),
        expires: taskcluster.fromNow('90 seconds'),
        capacity: 1,
        state: 'running',
        providerData: baseProviderData,
      });
      await worker.create(helper.db);

      // stubs for removeWorker and provisionResources
      sandbox.stub(provider, 'removeWorker').returns('stopped');
      sandbox.stub(provider, 'provisionResources').returns('requested');
    });

    teardown(function() {
      sandbox.restore();
    });

    const setState = async ({state, provisioningState, powerState}) => {
      await worker.update(helper.db, worker => {
        worker.state = state;
      });
      if (provisioningState) {
        fake.computeClient.virtualMachines.makeFakeResource('rgrp', baseProviderData.vm.name, {provisioningState});
      }
      if (powerState) {
        fake.computeClient.virtualMachines.setFakeInstanceView('rgrp', baseProviderData.vm.name, {
          statuses: [{code: powerState}],
        });
      }
    };

    test('updates deprecated disk providerdata to disks', async function() {
      await worker.update(helper.db, worker => {
        delete worker.providerData.disks;
        worker.providerData.disk = {name: "old_test_disk", id: false};
      });
      await provider.checkWorker({worker});
      await worker.reload(helper.db);
      assert.equal(worker.providerData.disks[0].name, "old_test_disk");
    });

    test('does nothing for still-running workers', async function() {
      await setState({state: 'running', provisioningState: 'Succeeded', powerState: 'PowerState/running'});
      await provider.checkWorker({worker});
      await worker.reload(helper.db);
      assert.equal(worker.state, 'running');
      assert(!provider.removeWorker.called);
      assert(!provider.provisionResources.called);
    });

    test('calls provisionResources for requested workers that have no instanceView', async function() {
      await setState({state: 'requested', provisioningState: 'Succeeded', powerState: null});
      await provider.checkWorker({worker});
      await worker.reload(helper.db);
      assert.equal(worker.state, 'requested'); // registerWorker changes this, not checkWorker
      assert(!provider.removeWorker.called);
      assert(provider.provisionResources.called);
    });

    test('calls provisionResources for requested workers that have no vm', async function() {
      await setState({state: 'requested', provisioningState: null, powerState: null});
      await provider.checkWorker({worker});
      await worker.reload(helper.db);
      assert.equal(worker.state, 'requested'); // registerWorker changes this, not checkWorker
      assert(!provider.removeWorker.called);
      assert(provider.provisionResources.called);
    });

    test('does nothing for requested workers that are fully started', async function() {
      await setState({state: 'requested', provisioningState: 'Succeeded', powerState: 'PowerState/running'});
      await provider.checkWorker({worker});
      await worker.reload(helper.db);
      assert.equal(worker.state, 'requested'); // registerWorker changes this, not checkWorker
      assert(!provider.removeWorker.called);
      assert(!provider.provisionResources.called);
    });

    test('calls removeWorker() for a running worker that has no VM', async function() {
      await setState({state: 'running', provisioningState: 'Deleting', powerState: 'PowerState/running'});
      await provider.checkWorker({worker});
      await worker.reload(helper.db);
      assert(provider.removeWorker.called);
      assert(!provider.provisionResources.called);
    });

    test('update expires for long-running worker', async function() {
      await setState({state: 'running', provisioningState: 'Succeeded', powerState: 'PowerState/running'});
      const expires = taskcluster.fromNow('-1 week');
      await worker.update(helper.db, worker => {
        worker.expires = expires;
      });
      await provider.checkWorker({worker});
      await worker.reload(helper.db);
      assert(worker.expires > expires);
      assert(!provider.removeWorker.called);
      assert(!provider.provisionResources.called);
    });

    test('remove unregistered workers after terminateAfter', async function() {
      await setState({state: 'requested', provisioningState: 'Succeeded', powerState: 'PowerState/running'});
      await worker.update(helper.db, worker => {
        worker.providerData.terminateAfter = Date.now() - 1000;
      });
      await provider.checkWorker({worker});
      await worker.reload(helper.db);
      assert(worker.state === 'stopped');
      assert(provider.removeWorker.called);
      assert(!provider.provisionResources.called);
    });

    test('do not remove unregistered workers before terminateAfter', async function() {
      await setState({state: 'requested', provisioningState: 'Succeeded', powerState: 'PowerState/running'});
      await worker.update(helper.db, worker => {
        worker.providerData.terminateAfter = Date.now() + 1000;
      });
      await provider.checkWorker({worker});
      await worker.reload(helper.db);
      assert(worker.state === 'requested');
      assert(!provider.removeWorker.called);
      assert(!provider.provisionResources.called);
    });
  });

  suite('registerWorker', function() {
    const workerGroup = 'westus';
    const vmId = '5d06deb3-807b-46dd-aef5-78aaf9193f71';
    const baseWorker = {
      workerPoolId,
      workerGroup,
      workerId: 'some-vm',
      providerId,
      created: taskcluster.fromNow('0 seconds'),
      lastModified: taskcluster.fromNow('0 seconds'),
      lastChecked: taskcluster.fromNow('0 seconds'),
      capacity: 1,
      expires: taskcluster.fromNow('90 seconds'),
      state: 'requested',
      providerData: {
        ...baseProviderData,
        vm: {
          name: 'some-vm',
          vmId: vmId,
        },
      },
    };

    setup('create vm', function() {
      fake.computeClient.virtualMachines.makeFakeResource('rgrp', 'some-vm', {
        vmId: '5d06deb3-807b-46dd-aef5-78aaf9193f71',
      });
    });

    for (const {name, defaultWorker} of [
      {name: 'pre-IDd', defaultWorker: baseWorker},
      {
        name: 'fetch-in-register',
        defaultWorker: {
          ...baseWorker,
          providerData: {
            ...baseProviderData,
            vm: {
              name: 'some-vm',
            },
          },
        },
      },
    ]) {
      suite(name, function() {
        test('document is not a valid PKCS#7 message', async function() {
          const workerPool = await makeWorkerPool();
          const worker = Worker.fromApi({
            ...defaultWorker,
          });
          await worker.create(helper.db);
          const document = 'this is not a valid PKCS#7 message';
          const workerIdentityProof = {document};
          await assert.rejects(() =>
            provider.registerWorker({workerPool, worker, workerIdentityProof}),
          /Signature validation error/);
          assert(monitor.manager.messages[0].Fields.error.includes('Too few bytes to read ASN.1 value.'));
        });

        test('document is empty', async function() {
          const workerPool = await makeWorkerPool();
          const worker = Worker.fromApi({
            ...defaultWorker,
          });
          await worker.create(helper.db);
          const document = '';
          const workerIdentityProof = {document};
          await assert.rejects(() =>
            provider.registerWorker({workerPool, worker, workerIdentityProof}),
          /Signature validation error/);
          assert(monitor.manager.messages[0].Fields.error.includes('Too few bytes to parse DER.'));
        });

        test('message does not match signature', async function() {
          const workerPool = await makeWorkerPool();
          const worker = Worker.fromApi({
            ...defaultWorker,
          });
          await worker.create(helper.db);
          // this file is a version of `azure_signature_good` where vmId has been edited in the message
          const document = fs.readFileSync(path.resolve(__dirname, 'fixtures/azure_message_bad')).toString();
          const workerIdentityProof = {document};
          await assert.rejects(() =>
            provider.registerWorker({workerPool, worker, workerIdentityProof}),
          /Signature validation error/);
          assert(monitor.manager.messages[0].Fields.message.includes('Error verifying PKCS#7 message signature'));
        });

        test('malformed signature', async function() {
          const workerPool = await makeWorkerPool();
          const worker = Worker.fromApi({
            ...defaultWorker,
          });
          await worker.create(helper.db);
          // this file is a version of `azure_signature_good` where the message signature has been edited
          const document = fs.readFileSync(path.resolve(__dirname, 'fixtures/azure_signature_bad')).toString();
          const workerIdentityProof = {document};
          await assert.rejects(() =>
            provider.registerWorker({workerPool, worker, workerIdentityProof}),
          /Signature validation error/);
          assert(monitor.manager.messages[0].Fields.message.includes('Error verifying PKCS#7 message signature'));
        });

        test('expired message', async function() {
          const workerPool = await makeWorkerPool();
          const worker = Worker.fromApi({
            ...defaultWorker,
          });
          await worker.create(helper.db);

          const document = fs.readFileSync(path.resolve(__dirname, 'fixtures/azure_signature_good')).toString();
          const workerIdentityProof = {document};
          provider._now = () => new Date(); // The certs that are checked-in are old so they should be expired now
          await assert.rejects(() =>
            provider.registerWorker({workerPool, worker, workerIdentityProof}),
          /Signature validation error/);
          assert(monitor.manager.messages[0].Fields.message.includes('Expired message'));
        });

        test('bad cert', async function() {
          const workerPool = await makeWorkerPool();
          const worker = Worker.fromApi({
            ...defaultWorker,
          });
          await worker.create(helper.db);
          const document = fs.readFileSync(path.resolve(__dirname, 'fixtures/azure_signature_good')).toString();
          const workerIdentityProof = {document};

          // Here we replace the intermediate certs with nothing and show that this should reject
          const oldCaStore = provider.caStore;
          provider.caStore = forge.pki.createCaStore([]);

          await assert.rejects(() =>
            provider.registerWorker({workerPool, worker, workerIdentityProof}),
          /Signature validation error/);
          assert(monitor.manager.messages[0].Fields.message.includes('Error verifying certificate chain'));
          assert(monitor.manager.messages[0].Fields.error.includes('Certificate is not trusted'));
          provider.caStore = oldCaStore;
        });

        test('wrong worker state (duplicate call to registerWorker)', async function() {
          const workerPool = await makeWorkerPool();
          const worker = Worker.fromApi({
            ...defaultWorker,
            state: 'running',
          });
          await worker.create(helper.db);
          const document = fs.readFileSync(path.resolve(__dirname, 'fixtures/azure_signature_good')).toString();
          const workerIdentityProof = {document};
          await assert.rejects(() =>
            provider.registerWorker({workerPool, worker, workerIdentityProof}),
          /Signature validation error/);
          assert(monitor.manager.messages[0].Fields.error.includes('already running'));
        });

        test('wrong vmID', async function() {
          const workerPool = await makeWorkerPool();
          const worker = Worker.fromApi({
            ...defaultWorker,
            providerData: {
              ...baseProviderData,
              vm: {
                name: baseProviderData.vm.name,
                vmId: 'wrongeba3-807b-46dd-aef5-78aaf9193f71',
              },
            },
          });
          await worker.create(helper.db);
          const document = fs.readFileSync(path.resolve(__dirname, 'fixtures/azure_signature_good')).toString();
          const workerIdentityProof = {document};
          await assert.rejects(() =>
            provider.registerWorker({workerPool, worker, workerIdentityProof}),
          /Signature validation error/);
          assert(monitor.manager.messages[0].Fields.message.includes('vmId mismatch'));
          assert.equal(monitor.manager.messages[0].Fields.vmId, vmId);
          assert.equal(monitor.manager.messages[0].Fields.expectedVmId, 'wrongeba3-807b-46dd-aef5-78aaf9193f71');
          assert.equal(monitor.manager.messages[0].Fields.workerId, 'some-vm');
        });

        test('sweet success', async function() {
          const workerPool = await makeWorkerPool();
          const worker = Worker.fromApi({
            ...defaultWorker,
            providerData: {
              ...defaultWorker.providerData,
              workerConfig: {
                "someKey": "someValue",
              },
            },
          });
          await worker.create(helper.db);
          const document = fs.readFileSync(path.resolve(__dirname, 'fixtures/azure_signature_good')).toString();
          const workerIdentityProof = {document};
          const res = await provider.registerWorker({workerPool, worker, workerIdentityProof});
          // allow +- 10 seconds since time passes while the test executes
          assert(res.expires - new Date() + 10000 > 96 * 3600 * 1000, res.expires);
          assert(res.expires - new Date() - 10000 < 96 * 3600 * 1000, res.expires);
          assert.equal(res.workerConfig.someKey, 'someValue');
        });

        test('sweet success (different reregister)', async function() {
          const workerPool = await makeWorkerPool();
          let worker = Worker.fromApi({
            ...defaultWorker,
            providerData: {
              ...defaultWorker.providerData,
              workerConfig: {
                "someKey": "someValue",
              },
            },
          });
          await worker.create(helper.db);

          await worker.update(helper.db, worker => {
            worker.providerData.reregistrationTimeout = 10 * 3600 * 1000;
          });
          const document = fs.readFileSync(path.resolve(__dirname, 'fixtures/azure_signature_good')).toString();
          const workerIdentityProof = {document};
          const res = await provider.registerWorker({workerPool, worker, workerIdentityProof});
          // allow +- 10 seconds since time passes while the test executes
          assert(res.expires - new Date() + 10000 > 10 * 3600 * 1000, res.expires);
          assert(res.expires - new Date() - 10000 < 10 * 3600 * 1000, res.expires);
          assert.equal(res.workerConfig.someKey, 'someValue');
        });
      });
    }
  });
});
