// Test child only: a native abort must never terminate the parent Electron process.
process.parentPort.on('message', () => process.abort());
