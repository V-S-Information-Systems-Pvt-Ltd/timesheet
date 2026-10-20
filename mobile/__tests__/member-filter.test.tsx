import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { TimesheetListScreen } from '../src/screens/TimesheetListScreen';
import { SearchablePickerModal } from '../src/components/SearchablePickerModal';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { useSessionActions, useSessionActor, useSessionReference, useSessionSync } from '../src/auth/SessionProvider';

jest.mock('../src/auth/SessionProvider', () => ({
  useSessionActions: jest.fn(), useSessionActor: jest.fn(), useSessionReference: jest.fn(), useSessionSync: jest.fn(),
}));

const people = [{ id: 'm1', name: 'Mia', email: 'mia@example.com' }];

async function mount(actor: object, listPeople: jest.Mock, onSelectFilterUser = jest.fn()) {
  jest.mocked(useSessionActor).mockReturnValue({ actor, effectiveActor: null } as unknown as ReturnType<typeof useSessionActor>);
  jest.mocked(useSessionSync).mockReturnValue({ isOffline: false } as ReturnType<typeof useSessionSync>);
  jest.mocked(useSessionReference).mockReturnValue({ reference: null, loadReference: jest.fn() } as unknown as ReturnType<typeof useSessionReference>);
  jest.mocked(useSessionActions).mockReturnValue({
    listPeople, listTimesheets: jest.fn().mockResolvedValue({ rows: [], total: 0 }), batchUpdateTimesheets: jest.fn(),
    deleteTimesheet: jest.fn(), deleteTimesheets: jest.fn(), duplicateTimesheet: jest.fn(), duplicateTimesheets: jest.fn(),
  } as unknown as ReturnType<typeof useSessionActions>);
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <ScreenTheme>
        <TimesheetListScreen isDarkMode={false} onBack={jest.fn()} onLogTime={jest.fn()} onSelectFilterUser={onSelectFilterUser} />
      </ScreenTheme>
    );
  });
  const button = () => r.root.findAllByProps({ accessibilityLabel: 'Filter by member' });
  return { r, button, onSelectFilterUser };
}

const manager = { id: 'u1', role: 'user', hierarchyRole: 'manager', permissionRole: 'user' };

describe('TimesheetListScreen member filter', () => {
  it('is hidden for actors who cannot view team', async () => {
    const { button } = await mount({ id: 'u1', role: 'user', hierarchyRole: 'user', permissionRole: 'user' }, jest.fn());
    expect(button()).toHaveLength(0);
  });

  it('selecting a member passes the Team-style params; All / Me clears', async () => {
    const { r, button, onSelectFilterUser } = await mount(manager, jest.fn().mockResolvedValue(people));
    await ReactTestRenderer.act(async () => { button()[0].props.onPress(); });
    const picker = () => r.root.findByType(SearchablePickerModal);
    expect(picker().props.items.map((i: { id: string }) => i.id)).toEqual(['all', 'm1']);
    await ReactTestRenderer.act(async () => { picker().props.onSelect({ id: 'm1', name: 'Mia' }); });
    expect(onSelectFilterUser).toHaveBeenCalledWith({ id: 'm1', name: 'Mia', email: 'mia@example.com' });
    await ReactTestRenderer.act(async () => { picker().props.onSelect({ id: 'all', name: 'All / Me' }); });
    expect(onSelectFilterUser).toHaveBeenLastCalledWith(null);
  });

  it('shows an inline picker error when people fail to load, leaving the list intact', async () => {
    const { r, button } = await mount(manager, jest.fn().mockRejectedValue(new Error('no people')));
    await ReactTestRenderer.act(async () => { button()[0].props.onPress(); });
    expect(r.root.findByType(SearchablePickerModal).props.error).toBe('no people');
    expect(button()).not.toHaveLength(0);
  });
});
