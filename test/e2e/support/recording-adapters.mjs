import * as runtime from '../../../dist/index.js';

export function createRecordingSqsAdapter(sdkClient) {
  const records = {
    receiveInputs: [],
    deleteInputs: [],
    deleteBatchInputs: [],
    visibilityInputs: [],
    visibilityBatchInputs: [],
  };
  const failReceiveOnceQueueUrls = new Set();
  const failedReceiveQueueUrls = new Set();

  const recordingClient = {
    send: async (command, options) => {
      const commandName = command?.constructor?.name;
      const input = structuredClone(command.input);

      if (commandName === 'ReceiveMessageCommand') {
        records.receiveInputs.push(input);
        if (failReceiveOnceQueueUrls.has(input.QueueUrl) && !failedReceiveQueueUrls.has(input.QueueUrl)) {
          failedReceiveQueueUrls.add(input.QueueUrl);
          throw new Error(`Injected receive failure for ${input.QueueUrl}`);
        }
      } else if (commandName === 'DeleteMessageCommand') {
        records.deleteInputs.push(input);
      } else if (commandName === 'DeleteMessageBatchCommand') {
        records.deleteBatchInputs.push(input);
      } else if (commandName === 'ChangeMessageVisibilityCommand') {
        records.visibilityInputs.push(input);
      } else if (commandName === 'ChangeMessageVisibilityBatchCommand') {
        records.visibilityBatchInputs.push(input);
      }

      return sdkClient.send(command, options);
    },
  };

  return {
    adapter: new runtime.AwsSqsAdapter(recordingClient),
    records,
    failReceiveOnceForQueue(queueUrl) {
      failReceiveOnceQueueUrls.add(queueUrl);
    },
  };
}

export function createRecordingSnsAdapter(sdkClient) {
  const records = { publishInputs: [], publishBatchInputs: [], listTopicsInputs: [] };

  const recordingClient = {
    send: async (command, options) => {
      const commandName = command?.constructor?.name;
      const input = structuredClone(command.input);

      if (commandName === 'PublishCommand') {
        records.publishInputs.push(input);
      } else if (commandName === 'PublishBatchCommand') {
        records.publishBatchInputs.push(input);
      } else if (commandName === 'ListTopicsCommand') {
        records.listTopicsInputs.push(input);
      }

      return sdkClient.send(command, options);
    },
  };

  return { adapter: new runtime.AwsSnsAdapter(recordingClient), records };
}
