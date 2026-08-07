import {
  ListTopicsCommand,
  type ListTopicsCommandInput,
  type ListTopicsCommandOutput,
  PublishBatchCommand,
  type PublishBatchCommandInput,
  type PublishBatchCommandOutput,
  PublishCommand,
  type PublishCommandInput,
  type PublishCommandOutput,
  SNSClient,
} from '@aws-sdk/client-sns';
import {
  CancelMessageMoveTaskCommand,
  type CancelMessageMoveTaskCommandInput,
  type CancelMessageMoveTaskCommandOutput,
  ChangeMessageVisibilityBatchCommand,
  type ChangeMessageVisibilityBatchCommandInput,
  type ChangeMessageVisibilityBatchCommandOutput,
  ChangeMessageVisibilityCommand,
  type ChangeMessageVisibilityCommandInput,
  DeleteMessageBatchCommand,
  type DeleteMessageBatchCommandInput,
  type DeleteMessageBatchCommandOutput,
  DeleteMessageCommand,
  type DeleteMessageCommandInput,
  GetQueueAttributesCommand,
  type GetQueueAttributesCommandInput,
  type GetQueueAttributesCommandOutput,
  GetQueueUrlCommand,
  type GetQueueUrlCommandInput,
  type GetQueueUrlCommandOutput,
  ListDeadLetterSourceQueuesCommand,
  type ListDeadLetterSourceQueuesCommandInput,
  type ListDeadLetterSourceQueuesCommandOutput,
  ListMessageMoveTasksCommand,
  type ListMessageMoveTasksCommandInput,
  type ListMessageMoveTasksCommandOutput,
  ListQueuesCommand,
  type ListQueuesCommandInput,
  type ListQueuesCommandOutput,
  ReceiveMessageCommand,
  type ReceiveMessageCommandInput,
  type ReceiveMessageCommandOutput,
  SendMessageBatchCommand,
  type SendMessageBatchCommandInput,
  type SendMessageBatchCommandOutput,
  SendMessageCommand,
  type SendMessageCommandInput,
  type SendMessageCommandOutput,
  SQSClient,
  StartMessageMoveTaskCommand,
  type StartMessageMoveTaskCommandInput,
  type StartMessageMoveTaskCommandOutput,
} from '@aws-sdk/client-sqs';
import type { SqsRuntimeClient, SqsRuntimeRequestOptions } from '../core';
import type { SqsQueueOperationsClient } from '../queue-ops/types';
import type { SnsTransportClient, SqsQueueDiscoveryClient, SqsTransportClient } from './types';

export class AwsSqsAdapter
  implements SqsTransportClient, SqsRuntimeClient, SqsQueueOperationsClient, SqsQueueDiscoveryClient
{
  constructor(private readonly client: SQSClient) {}

  receiveMessage(
    input: ReceiveMessageCommandInput,
    options?: SqsRuntimeRequestOptions,
  ): Promise<ReceiveMessageCommandOutput> {
    return this.client.send(new ReceiveMessageCommand(input), options);
  }

  async deleteMessage(input: DeleteMessageCommandInput): Promise<void> {
    await this.client.send(new DeleteMessageCommand(input));
  }

  async changeMessageVisibility(input: ChangeMessageVisibilityCommandInput): Promise<void> {
    await this.client.send(new ChangeMessageVisibilityCommand(input));
  }

  async deleteMessageBatch(input: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput> {
    return this.client.send(new DeleteMessageBatchCommand(input));
  }

  async changeMessageVisibilityBatch(
    input: ChangeMessageVisibilityBatchCommandInput,
  ): Promise<ChangeMessageVisibilityBatchCommandOutput> {
    return this.client.send(new ChangeMessageVisibilityBatchCommand(input));
  }

  async getQueueUrl(
    input: Pick<GetQueueUrlCommandInput, 'QueueName' | 'QueueOwnerAWSAccountId'>,
  ): Promise<Pick<GetQueueUrlCommandOutput, 'QueueUrl'>> {
    const response = await this.client.send(new GetQueueUrlCommand(input));
    return { QueueUrl: response.QueueUrl };
  }

  async listQueues(
    input: Pick<ListQueuesCommandInput, 'QueueNamePrefix' | 'NextToken' | 'MaxResults'>,
  ): Promise<Pick<ListQueuesCommandOutput, 'QueueUrls' | 'NextToken'>> {
    const response = await this.client.send(new ListQueuesCommand(input));
    return { QueueUrls: response.QueueUrls, NextToken: response.NextToken };
  }

  async getQueueAttributes(
    input: Pick<GetQueueAttributesCommandInput, 'QueueUrl' | 'AttributeNames'>,
  ): Promise<Pick<GetQueueAttributesCommandOutput, 'Attributes'>> {
    const response = await this.client.send(new GetQueueAttributesCommand(input));
    return { Attributes: response.Attributes };
  }

  async listDeadLetterSourceQueues(
    input: Pick<ListDeadLetterSourceQueuesCommandInput, 'QueueUrl' | 'NextToken' | 'MaxResults'>,
  ): Promise<Pick<ListDeadLetterSourceQueuesCommandOutput, 'queueUrls' | 'NextToken'>> {
    const response = await this.client.send(new ListDeadLetterSourceQueuesCommand(input));
    return { queueUrls: response.queueUrls, NextToken: response.NextToken };
  }

  async startMessageMoveTask(
    input: Pick<StartMessageMoveTaskCommandInput, 'SourceArn' | 'DestinationArn' | 'MaxNumberOfMessagesPerSecond'>,
  ): Promise<Pick<StartMessageMoveTaskCommandOutput, 'TaskHandle'>> {
    const response = await this.client.send(new StartMessageMoveTaskCommand(input));
    return { TaskHandle: response.TaskHandle };
  }

  async listMessageMoveTasks(
    input: Pick<ListMessageMoveTasksCommandInput, 'SourceArn' | 'MaxResults'>,
  ): Promise<Pick<ListMessageMoveTasksCommandOutput, 'Results'>> {
    const response = await this.client.send(new ListMessageMoveTasksCommand(input));
    return { Results: response.Results };
  }

  async cancelMessageMoveTask(
    input: Pick<CancelMessageMoveTaskCommandInput, 'TaskHandle'>,
  ): Promise<Pick<CancelMessageMoveTaskCommandOutput, 'ApproximateNumberOfMessagesMoved'>> {
    const response = await this.client.send(new CancelMessageMoveTaskCommand(input));
    return { ApproximateNumberOfMessagesMoved: response.ApproximateNumberOfMessagesMoved };
  }

  async sendMessage(input: SendMessageCommandInput): Promise<SendMessageCommandOutput> {
    return this.client.send(new SendMessageCommand(input));
  }

  async sendMessageBatch(input: SendMessageBatchCommandInput): Promise<SendMessageBatchCommandOutput> {
    return this.client.send(new SendMessageBatchCommand(input));
  }
}

export class AwsSnsAdapter implements SnsTransportClient {
  constructor(private readonly client: SNSClient) {}

  async listTopics(
    input: Pick<ListTopicsCommandInput, 'NextToken'>,
  ): Promise<Pick<ListTopicsCommandOutput, 'NextToken' | 'Topics'>> {
    const response = await this.client.send(new ListTopicsCommand(input));
    return { NextToken: response.NextToken, Topics: response.Topics };
  }

  async publish(input: PublishCommandInput): Promise<PublishCommandOutput> {
    return this.client.send(new PublishCommand(input));
  }

  async publishBatch(input: PublishBatchCommandInput): Promise<PublishBatchCommandOutput> {
    return this.client.send(new PublishBatchCommand(input));
  }
}
