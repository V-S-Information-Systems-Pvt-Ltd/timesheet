export type TelemetryEventName =
  | 'sync_start'
  | 'sync_item_success'
  | 'sync_item_failure'
  | 'sync_complete'
  | 'offline_enqueue'
  | 'network_status_change'
  | 'action_error';

export interface TelemetryEvent {
  id: string;
  name: TelemetryEventName;
  timestamp: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export type TelemetryListener = (event: TelemetryEvent) => void;

export class TelemetryService {
  private events: TelemetryEvent[] = [];
  private listeners: Set<TelemetryListener> = new Set();
  private readonly maxEvents = 100;

  log(
    name: TelemetryEventName,
    metadata?: Record<string, unknown>,
    durationMs?: number
  ): TelemetryEvent {
    const event: TelemetryEvent = {
      id: `tel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      timestamp: new Date().toISOString(),
      durationMs,
      metadata,
    };

    this.events.unshift(event);
    if (this.events.length > this.maxEvents) {
      this.events.length = this.maxEvents;
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener exceptions
      }
    }

    return event;
  }

  getEvents(limit = 50): TelemetryEvent[] {
    return this.events.slice(0, limit);
  }

  clear(): void {
    this.events = [];
  }

  subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const telemetry = new TelemetryService();
