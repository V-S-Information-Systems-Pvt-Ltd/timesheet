import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { LogTimeScreen } from '../src/screens/LogTimeScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';
import { stepHours } from '../src/utils/hours-stepper';

jest.mock('../src/api/client');
jest.setTimeout(15000);

describe('stepHours', () => {
  it('steps by the delta, treating a blank field as zero', () => {
    expect(stepHours('', 0.5)).toBe('0.5');
    expect(stepHours('7', 0.5)).toBe('7.5');
    expect(stepHours('7.5', -0.5)).toBe('7');
    expect(stepHours('abc', 0.5)).toBe('0.5');
  });

  it('clamps to 0.5-24', () => {
    expect(stepHours('0.5', -0.5)).toBe('0.5');
    expect(stepHours('', -0.5)).toBe('0.5');
    expect(stepHours('0.25', -0.5)).toBe('0.5');
    expect(stepHours('23.75', 0.5)).toBe('24');
    expect(stepHours('24', 0.5)).toBe('24');
    expect(stepHours('30', -0.5)).toBe('24');
  });
});

describe('Log time hours stepper', () => {
  async function mountLogTime() {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(
      () =>
        ({
          getConfig: jest.fn().mockResolvedValue({}),
          refresh: jest.fn().mockResolvedValue({
            accessToken: 'access-123',
            refreshToken: 'refresh-123',
            accessTokenExpiresAt: '',
            sessionId: 's1',
          }),
          getMe: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'emp@example.com',
            role: 'user',
            permissionRole: 'user',
            hierarchyRole: 'user',
            isActive: true,
          }),
          getReference: jest.fn().mockResolvedValue({ projects: [], activityTypes: [] }),
          getDashboard: jest.fn().mockResolvedValue({}),
        } as unknown as ApiClient)
    );
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <LogTimeScreen
              initialValues={{ hoursWorked: 1.5 }}
              isDarkMode={false}
              onBack={jest.fn()}
              onSuccess={jest.fn()}
            />
          </SessionProvider>
        </ScreenTheme>
      );
    });
    return renderer;
  }

  const hours = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAllByProps({ accessibilityLabel: 'Hours Worked' })[0].props.value;
  const press = async (renderer: ReactTestRenderer.ReactTestRenderer, accessibilityLabel: string) => {
    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByProps({ accessibilityLabel })[0].props.onPress();
    });
  };

  it('opens with the prefilled hours and steps them in half hours', async () => {
    const renderer = await mountLogTime();
    expect(hours(renderer)).toBe('1.5');

    await press(renderer, 'Add 0.5 hours');
    expect(hours(renderer)).toBe('2');
    await press(renderer, 'Subtract 0.5 hours');
    await press(renderer, 'Subtract 0.5 hours');
    expect(hours(renderer)).toBe('1');
  });

  it('stops at 0.5 on the way down and at 24 on the way up', async () => {
    const renderer = await mountLogTime();

    for (let i = 0; i < 4; i += 1) await press(renderer, 'Subtract 0.5 hours');
    expect(hours(renderer)).toBe('0.5');

    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByProps({ accessibilityLabel: 'Hours Worked' })[0].props.onChangeText('23.5');
    });
    await press(renderer, 'Add 0.5 hours');
    await press(renderer, 'Add 0.5 hours');
    expect(hours(renderer)).toBe('24');
  });

  it('keeps the field editable for direct entry', async () => {
    const renderer = await mountLogTime();
    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByProps({ accessibilityLabel: 'Hours Worked' })[0].props.onChangeText('6.25');
    });
    expect(hours(renderer)).toBe('6.25');
    await press(renderer, 'Add 0.5 hours');
    expect(hours(renderer)).toBe('6.75');
  });
});
