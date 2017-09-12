const cluster = require('cluster');
if (cluster.isMaster) module.exports = require('./master-list')
else if (cluster.isWorker) module.exports = require('./worker-list')
else throw new Error('Cannot determine master-worker relationship.')
