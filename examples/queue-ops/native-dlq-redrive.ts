import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsAdapter,
  type CancelSqsDlqRedriveResult,
  type ListSqsDlqRedriveTasksResult,
  type SqsDeadLetterSourceQueuesResult,
  SqsDlqRedriveManager,
  type SqsQueueDescription,
  SqsQueueInspector,
  type StartSqsDlqRedriveResult,
} from '@idenstra/messaging-runtime';

type Command = 'inspect' | 'sources' | 'tasks' | 'start' | 'cancel';

async function main(): Promise<void> {
  const [command, firstArg, secondArg] = process.argv.slice(2);
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const maxMessagesPerSecond = readOptionalInteger(process.env.MAX_MESSAGES_PER_SECOND);

  const awsSqs = new SQSClient({ region });
  const sqsAdapter = new AwsSqsAdapter(awsSqs);
  const inspector = new SqsQueueInspector(sqsAdapter);
  const redriveManager = new SqsDlqRedriveManager(sqsAdapter, { queueInspector: inspector });

  switch (command as Command) {
    case 'inspect': {
      const queue = requireArg(firstArg, 'queue identifier');
      printResult(await inspector.inspectQueue(queue));
      return;
    }
    case 'sources': {
      const queue = requireArg(firstArg, 'dead-letter queue identifier');
      printResult(await inspector.listDeadLetterSourceQueues(queue));
      return;
    }
    case 'tasks': {
      const queue = requireArg(firstArg, 'dead-letter queue identifier');
      printResult(await redriveManager.listRedriveTasks({ sourceQueue: queue }));
      return;
    }
    case 'start': {
      const sourceQueue = requireArg(firstArg, 'dead-letter queue identifier');
      printResult(
        await redriveManager.startRedrive({ sourceQueue, destinationQueue: secondArg, maxMessagesPerSecond }),
      );
      return;
    }
    case 'cancel': {
      const taskHandle = requireArg(firstArg, 'message move task handle');
      printResult(await redriveManager.cancelRedrive({ taskHandle }));
      return;
    }
    default:
      printUsage();
      process.exitCode = 1;
  }
}

function requireArg(value: string | undefined, label: string): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing ${label}.`);
  }

  return value;
}

function readOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error('MAX_MESSAGES_PER_SECOND must be an integer when provided.');
  }

  return parsed;
}

function printResult(
  result:
    | CancelSqsDlqRedriveResult
    | ListSqsDlqRedriveTasksResult
    | SqsDeadLetterSourceQueuesResult
    | SqsQueueDescription
    | StartSqsDlqRedriveResult,
): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function printUsage(): void {
  process.stdout.write(`Usage:
  AWS_REGION=us-east-1 node native-dlq-redrive.js inspect <queue-name|queue-url|queue-arn>
  AWS_REGION=us-east-1 node native-dlq-redrive.js sources <dlq-name|dlq-url|dlq-arn>
  AWS_REGION=us-east-1 node native-dlq-redrive.js tasks <dlq-name|dlq-url|dlq-arn>
  AWS_REGION=us-east-1 MAX_MESSAGES_PER_SECOND=50 node native-dlq-redrive.js start <dlq-name|dlq-url|dlq-arn> [destination-name|destination-url|destination-arn]
  AWS_REGION=us-east-1 node native-dlq-redrive.js cancel <task-handle>\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
