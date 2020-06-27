const fs = require('fs');
const { settingsPath } = require('../../../test/settings');
const Debug = require('debug');

let debug = Debug('docker-worker:host:test');

let gracefulTerminationCallback = null;

function billingCycleUptime() {
  let path = settingsPath('billingCycleUptime');

  try {
    return parseInt(fs.readFileSync(path), 10);
  } catch (e) {
    return 0;
  }
}

module.exports = {
  billingCycleUptime,

  setup() {
    // fake graceful termination by rapidly polling the file that
    // test/settings.js will create
    let interval = setInterval(() => {
      let path = settingsPath('nodeTermination');
      let content;
      try {
        content = fs.readFileSync(path, 'utf8');
      }
      catch (e) {
        content = '';
      }

      if (content && gracefulTerminationCallback) {
        gracefulTerminationCallback(false);
        gracefulTerminationCallback = null;
        clearInterval(interval);
      }
    }, 100);
  },

  onGracefulTermination(cb) {
    gracefulTerminationCallback = cb;
  },

  configure() {
    let path = settingsPath('configure');
    let config = {
      publicIp: '127.0.0.1',
      privateIp: '169.254.1.1',
      workerNodeType: 'test-worker',
      instanceId: 'test-worker-instance',
      region: 'us-middle-1a',
      instanceType: 'r3-superlarge',
      rootUrl: process.env.TASKCLUSTER_ROOT_URL,
    };
    try {
      let content = fs.readFileSync(path, 'utf8');
      debug('configure read:', content);
      content = JSON.parse(content);
      Object.assign(config, content);
      return config;
    } catch (e) {
      return config;
    }
  },
  async shutdown() {
    process.exit(0);
  },
  async onNewCredentials(cb) {
  },
};
