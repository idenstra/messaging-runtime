import type {
  ChangeMessageVisibilityCommandInput,
  DeleteMessageBatchCommandInput,
  DeleteMessageBatchCommandOutput,
  DeleteMessageCommandInput,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
  Message as SqsSdkMessage,
} from '@aws-sdk/client-sqs';

export interface SqsWorkerLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface SqsWorkerMessageAttributeValue {
  stringValue?: string;
  binaryValue?: Uint8Array;
  stringListValues?: string[];
  binaryListValues?: Uint8Array[];
  dataType?: string;
}

export interface SqsWorkerMessageSystemAttributes {
  ApproximateReceiveCount: number;
  ApproximateFirstReceiveTimestamp: Date;
  SentTimestamp: Date;
  SenderId: string;
  MessageGroupId: string;
  MessageDeduplicationId: string;
  SequenceNumber: string;
  AWSTraceHeader: string;
  DeadLetterQueueSourceArn: string;
}

export interface SqsWorkerMessage {
  messageId: string;
  receiptHandle: string;
  body?: string;
  attributes: Record<string, string>;
  systemAttributes: Partial<SqsWorkerMessageSystemAttributes>;
  messageAttributes: Record<string, SqsWorkerMessageAttributeValue>;
  raw: SqsSdkMessage;
}

export type SqsWorkerAckAction = 'delete' | 'keep';
export type SqsWorkerFailureKind = 'decode' | 'handler' | 'timeout';
export type SqsWorkerTimeoutStrategy = 'cooperative' | 'abandon';
export type SqsWorkerHeartbeatSource = 'interval' | 'manual';
export type SqsWorkerLateSettlementOutcome = 'resolved' | 'rejected';
export type SqsWorkerMessageFinalizationReason = 'success' | 'failure' | 'timeout';
export type SqsWorkerDeleteBatchFailureMode = 'request-error' | 'response-failure';
export type SqsWorkerBufferedMessageDropReason = 'missing-receipt-handle' | 'pre-dispatch-visibility-failure';
export type SqsWorkerReceiveRequestAttemptIdMode = 'off' | 'runtime' | 'custom';

export interface SqsWorkerHandlerResult {
  action?: SqsWorkerAckAction;
}

export interface SqsWorkerHandlerContext<TPayload> {
  routeName: string;
  queueUrl: string;
  payload: TPayload;
  message: SqsWorkerMessage;
  abortSignal: AbortSignal;
  heartbeat(): Promise<void>;
}

export type SqsWorkerHandler<TPayload> = (
  context: SqsWorkerHandlerContext<TPayload>,
) => Promise<SqsWorkerHandlerResult | ReturnType<() => void> | undefined>;

export interface SqsWorkerErrorContext<TPayload> {
  routeName: string;
  queueUrl: string;
  message: SqsWorkerMessage;
  payload?: TPayload;
  abortSignal: AbortSignal;
  failureKind: SqsWorkerFailureKind;
  error: unknown;
  durationMs: number;
  timeoutStrategy?: SqsWorkerTimeoutStrategy;
  settlementOutcome?: SqsWorkerLateSettlementOutcome | 'pending';
  settlementError?: unknown;
}

export type SqsWorkerErrorHook<TPayload> = (
  context: SqsWorkerErrorContext<TPayload>,
) =>
  | SqsWorkerAckAction
  | ReturnType<() => void>
  | undefined
  | Promise<SqsWorkerAckAction | ReturnType<() => void> | undefined>;

export interface SqsWorkerReceivePolicy {
  requestAttemptIdMode?: SqsWorkerReceiveRequestAttemptIdMode;
}

export interface SqsWorkerReceiveStrategy {
  policy?: Partial<SqsWorkerReceivePolicy>;
  createRequestAttemptId?: () => string;
}

export interface SqsWorkerRouteConfig {
  concurrency: number;
  waitTimeSeconds: number;
  visibilityTimeoutSeconds: number;
  heartbeatIntervalMs: number;
  emptyReceiveDelayMs: number;
  errorBackoffMs: number;
  maxMessagesPerPoll: number;
  handlerTimeoutMs?: number;
  timeoutStrategy: SqsWorkerTimeoutStrategy;
  failureAction: SqsWorkerAckAction;
}

export interface SqsWorkerRoute<TPayload> {
  name: string;
  queueUrl: string;
  decodePayload?: (message: SqsWorkerMessage) => TPayload;
  handle: SqsWorkerHandler<TPayload>;
  onError?: SqsWorkerErrorHook<TPayload>;
  config?: Partial<SqsWorkerRouteConfig>;
  receive?: SqsWorkerReceiveStrategy;
}

export interface SqsWorkerManagerOptions {
  logger?: SqsWorkerLogger;
  defaults?: Partial<SqsWorkerRouteConfig>;
  receiveDefaults?: Partial<SqsWorkerReceivePolicy>;
  onEvent?: SqsWorkerRuntimeEventHook;
}

export interface SqsWorkerRouteCounters {
  receiveEmptyCount: number;
  messagesReceivedCount: number;
  handlerStartedCount: number;
  handlerSuccessCount: number;
  handlerFailureCount: number;
  handlerTimeoutCount: number;
  lateSettlementCount: number;
  messageDeleteCount: number;
  messageKeepCount: number;
  heartbeatSuccessCount: number;
  heartbeatFailureCount: number;
  pollErrorCount: number;
  deleteBatchFailureCount: number;
  messageDeleteFailureCount: number;
  preDispatchVisibilityFailureCount: number;
  bufferedMessageDropCount: number;
}

export interface SqsWorkerRouteStatus {
  name: string;
  queueUrl: string;
  running: boolean;
  stopping: boolean;
  inFlight: number;
  buffered: number;
  counters: SqsWorkerRouteCounters;
  lastReceiveAt?: Date;
  lastReceiveEmptyAt?: Date;
  lastStartedAt?: Date;
  lastSuccessAt?: Date;
  lastErrorAt?: Date;
  lastErrorMessage?: string;
  lastFailureKind?: SqsWorkerFailureKind;
  lastTimeoutAt?: Date;
  lastDeleteAt?: Date;
  lastKeepAt?: Date;
  lastHeartbeatSuccessAt?: Date;
  lastHeartbeatFailureAt?: Date;
  lastHeartbeatFailureMessage?: string;
  lastLateSettlementAt?: Date;
  lastLateSettlementOutcome?: SqsWorkerLateSettlementOutcome;
  lastPollErrorAt?: Date;
  lastPollErrorMessage?: string;
  lastDeleteBatchFailureAt?: Date;
  lastDeleteBatchFailureMessage?: string;
  lastMessageDeleteFailureAt?: Date;
  lastMessageDeleteFailureMessage?: string;
  lastPreDispatchVisibilityFailureAt?: Date;
  lastPreDispatchVisibilityFailureMessage?: string;
  lastBufferedMessageDropAt?: Date;
  lastBufferedMessageDropReason?: SqsWorkerBufferedMessageDropReason;
}

export interface SqsWorkerManagerSnapshot {
  started: boolean;
  stopping: boolean;
  routeCount: number;
  totalInFlight: number;
  totalBuffered: number;
  counters: SqsWorkerRouteCounters;
  routes: SqsWorkerRouteStatus[];
}

export interface SqsWorkerRuntimeEventBase {
  type: string;
  at: Date;
  routeName: string;
  queueUrl: string;
}

export interface SqsWorkerReceiveEmptyEvent extends SqsWorkerRuntimeEventBase {
  type: 'receive-empty';
}

export interface SqsWorkerPollErrorEvent extends SqsWorkerRuntimeEventBase {
  type: 'poll-error';
  error: unknown;
  errorDetail: string;
  backoffMs: number;
}

export interface SqsWorkerMessagesReceivedEvent extends SqsWorkerRuntimeEventBase {
  type: 'messages-received';
  messageCount: number;
}

export interface SqsWorkerHandlerStartEvent extends SqsWorkerRuntimeEventBase {
  type: 'handler-start';
  messageId: string;
}

export interface SqsWorkerHandlerSuccessEvent extends SqsWorkerRuntimeEventBase {
  type: 'handler-success';
  messageId: string;
  durationMs: number;
}

export interface SqsWorkerHandlerFailureEvent extends SqsWorkerRuntimeEventBase {
  type: 'handler-failure';
  messageId: string;
  failureKind: Exclude<SqsWorkerFailureKind, 'timeout'>;
  durationMs: number;
  action: SqsWorkerAckAction;
  error: unknown;
}

export interface SqsWorkerHandlerTimeoutEvent extends SqsWorkerRuntimeEventBase {
  type: 'handler-timeout';
  messageId: string;
  durationMs: number;
  timeoutStrategy: SqsWorkerTimeoutStrategy;
  settlementOutcome: SqsWorkerLateSettlementOutcome | 'pending';
  error: unknown;
}

export interface SqsWorkerLateSettlementEvent extends SqsWorkerRuntimeEventBase {
  type: 'late-settlement';
  messageId: string;
  durationMs: number;
  outcome: SqsWorkerLateSettlementOutcome;
  error?: unknown;
}

export interface SqsWorkerMessageDeleteEvent extends SqsWorkerRuntimeEventBase {
  type: 'message-delete';
  messageId: string;
  reason: SqsWorkerMessageFinalizationReason;
}

export interface SqsWorkerDeleteBatchFailureEvent extends SqsWorkerRuntimeEventBase {
  type: 'delete-batch-failure';
  batchSize: number;
  failedCount: number;
  messageIds: string[];
  failureMode: SqsWorkerDeleteBatchFailureMode;
  errorDetail: string;
  error?: unknown;
}

export interface SqsWorkerMessageDeleteFailureEvent extends SqsWorkerRuntimeEventBase {
  type: 'message-delete-failure';
  messageId: string;
  reason: SqsWorkerMessageFinalizationReason;
  error: unknown;
  errorDetail: string;
}

export interface SqsWorkerPreDispatchVisibilityFailureEvent extends SqsWorkerRuntimeEventBase {
  type: 'pre-dispatch-visibility-failure';
  messageId: string;
  bufferedAgeMs: number;
  error: unknown;
  errorDetail: string;
}

export interface SqsWorkerBufferedMessageDropEvent extends SqsWorkerRuntimeEventBase {
  type: 'buffered-message-drop';
  messageId: string;
  dropReason: SqsWorkerBufferedMessageDropReason;
  bufferedAgeMs?: number;
  error?: unknown;
  errorDetail?: string;
}

export interface SqsWorkerMessageKeepEvent extends SqsWorkerRuntimeEventBase {
  type: 'message-keep';
  messageId: string;
  reason: SqsWorkerMessageFinalizationReason;
}

export interface SqsWorkerHeartbeatSuccessEvent extends SqsWorkerRuntimeEventBase {
  type: 'heartbeat-success';
  messageId: string;
  source: SqsWorkerHeartbeatSource;
}

export interface SqsWorkerHeartbeatFailureEvent extends SqsWorkerRuntimeEventBase {
  type: 'heartbeat-failure';
  messageId: string;
  source: SqsWorkerHeartbeatSource;
  error: unknown;
}

export type SqsWorkerRuntimeEvent =
  | SqsWorkerReceiveEmptyEvent
  | SqsWorkerPollErrorEvent
  | SqsWorkerMessagesReceivedEvent
  | SqsWorkerHandlerStartEvent
  | SqsWorkerHandlerSuccessEvent
  | SqsWorkerHandlerFailureEvent
  | SqsWorkerHandlerTimeoutEvent
  | SqsWorkerLateSettlementEvent
  | SqsWorkerMessageDeleteEvent
  | SqsWorkerDeleteBatchFailureEvent
  | SqsWorkerMessageDeleteFailureEvent
  | SqsWorkerPreDispatchVisibilityFailureEvent
  | SqsWorkerBufferedMessageDropEvent
  | SqsWorkerMessageKeepEvent
  | SqsWorkerHeartbeatSuccessEvent
  | SqsWorkerHeartbeatFailureEvent;

export type SqsWorkerRuntimeEventHook = (event: SqsWorkerRuntimeEvent) => void;

export interface SqsRuntimeClient {
  receiveMessage(
    input: ReceiveMessageCommandInput,
    options?: SqsRuntimeRequestOptions,
  ): Promise<ReceiveMessageCommandOutput>;
  deleteMessage(input: DeleteMessageCommandInput): Promise<void>;
  deleteMessageBatch(input: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput>;
  changeMessageVisibility(input: ChangeMessageVisibilityCommandInput): Promise<void>;
}

export interface SqsRuntimeRequestOptions {
  abortSignal?: AbortSignal;
}

export class SqsWorkerTimeoutError extends Error {
  readonly routeName: string;
  readonly messageId: string;
  readonly timeoutMs: number;
  readonly timeoutStrategy: SqsWorkerTimeoutStrategy;

  constructor(options: {
    routeName: string;
    messageId: string;
    timeoutMs: number;
    timeoutStrategy: SqsWorkerTimeoutStrategy;
  }) {
    super(`SQS worker handler timed out after ${options.timeoutMs}ms on route ${options.routeName}.`);
    this.name = 'SqsWorkerTimeoutError';
    this.routeName = options.routeName;
    this.messageId = options.messageId;
    this.timeoutMs = options.timeoutMs;
    this.timeoutStrategy = options.timeoutStrategy;
  }
}
