import {
  UUID,
  UserApp,
  BoosterConfig,
  EventEnvelope,
  OptimisticConcurrencyUnexpectedVersionError,
  EntitySnapshotEnvelope,
  NonPersistedEventEnvelope,
} from '@boostercloud/framework-types'
import { retryIfError, getLogger } from '@boostercloud/framework-common-helpers'
import { EventRegistry } from '..'

// eslint-disable-next-line @typescript-eslint/no-magic-numbers
const originOfTime = new Date(0).toISOString()

export function rawEventsToEnvelopes(rawEvents: Array<unknown>): Array<EventEnvelope> {
  return rawEvents.map((event) => event as EventEnvelope)
}

export async function readEntityEventsSince(
  eventRegistry: EventRegistry,
  config: BoosterConfig,
  entityTypeName: string,
  entityID: UUID,
  since?: string
): Promise<Array<EventEnvelope>> {
  const logger = getLogger(config, 'events-adapter#readEntityEventsSince')
  const fromTime = since ? since : originOfTime

  const query = {
    entityID: entityID,
    entityTypeName: entityTypeName,
    kind: 'event',
    createdAt: {
      $gt: fromTime,
    },
  }
  const result = (await eventRegistry.query(query)) as Array<EventEnvelope>

  logger.debug(`Loaded events for entity ${entityTypeName} with ID ${entityID} with result:`, result)
  return result
}

export async function readEntityLatestSnapshot(
  eventRegistry: EventRegistry,
  config: BoosterConfig,
  entityTypeName: string,
  entityID: UUID
): Promise<EntitySnapshotEnvelope | undefined> {
  const logger = getLogger(config, 'events-adapter#readEntityLatestSnapshot')
  const query = {
    entityID: entityID,
    entityTypeName: entityTypeName,
    kind: 'snapshot',
  }

  const snapshot = await eventRegistry.queryLatestSnapshot(query)

  if (snapshot) {
    logger.debug(`Snapshot found for entity ${entityTypeName} with ID ${entityID}:`, snapshot)
    return snapshot as EntitySnapshotEnvelope
  } else {
    logger.debug(`No snapshot found for entity ${entityTypeName} with ID ${entityID}.`)
    return undefined
  }
}

export async function storeEvents(
  userApp: UserApp,
  eventRegistry: EventRegistry,
  eventEnvelopes: Array<NonPersistedEventEnvelope>,
  config: BoosterConfig
): Promise<void> {
  const logger = getLogger(config, 'events-adapter#storeEvents')
  logger.debug('Storing the following event envelopes:', eventEnvelopes)
  for (const eventEnvelope of eventEnvelopes) {
    await retryIfError(() => persistEvent(eventRegistry, eventEnvelope), OptimisticConcurrencyUnexpectedVersionError)
  }
  logger.debug('EventEnvelopes stored')

  await userApp.boosterEventDispatcher(eventEnvelopes)
}

export async function storeSnapshot(
  eventRegistry: EventRegistry,
  snapshotEnvelope: EntitySnapshotEnvelope,
  config: BoosterConfig
): Promise<void> {
  const logger = getLogger(config, 'events-adapter#storeSnapshot')
  logger.debug('Storing the following snapshot envelope:', snapshotEnvelope)
  await retryIfError(() => eventRegistry.store(snapshotEnvelope), OptimisticConcurrencyUnexpectedVersionError)
  logger.debug('Snapshot stored')
}

async function persistEvent(eventRegistry: EventRegistry, eventEnvelope: NonPersistedEventEnvelope): Promise<void> {
  const persistableEvent = {
    ...eventEnvelope,
    persistedAt: new Date().toISOString(),
  }
  return eventRegistry.store(persistableEvent)
  //TODO: check when there is a write error to implement Optimistic Concurrency
}
