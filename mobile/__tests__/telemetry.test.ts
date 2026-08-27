import { TelemetryService } from '../src/telemetry/telemetry';

describe('TelemetryService', () => {
  it('logs events, caps history, and notifies subscribers', () => {
    const tel = new TelemetryService();
    const mockListener = jest.fn();
    const unsubscribe = tel.subscribe(mockListener);

    const event = tel.log('sync_start', { count: 3 }, 15);
    expect(event.name).toBe('sync_start');
    expect(event.metadata).toEqual({ count: 3 });
    expect(event.durationMs).toBe(15);
    expect(mockListener).toHaveBeenCalledWith(event);

    const history = tel.getEvents();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(event.id);

    unsubscribe();
    tel.log('sync_complete', { processed: 3 });
    expect(mockListener).toHaveBeenCalledTimes(1);

    tel.clear();
    expect(tel.getEvents()).toHaveLength(0);
  });
});
