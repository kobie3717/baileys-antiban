import { HealthMonitor } from '../src/health.js';

describe('HealthMonitor', () => {
  let health: HealthMonitor;
  let riskChanges: any[] = [];

  beforeEach(() => {
    riskChanges = [];
    health = new HealthMonitor({
      disconnectWarningThreshold: 3,
      disconnectCriticalThreshold: 5,
      failedMessageThreshold: 5,
      autoPauseAt: 'high',
      onRiskChange: (status) => {
        riskChanges.push(status);
      },
    });
  });

  describe('Disconnect tracking', () => {
    test('tracks regular disconnects', () => {
      health.recordDisconnect('connection lost');
      health.recordDisconnect('timeout');

      const status = health.getStatus();
      expect(status.stats.disconnectsLastHour).toBe(2);
      expect(status.risk).toBe('low');
    });

    test('escalates risk on frequent disconnects', () => {
      // 3 disconnects = warning threshold
      for (let i = 0; i < 3; i++) {
        health.recordDisconnect('timeout');
      }

      const status = health.getStatus();
      expect(status.risk).toBe('medium');
      expect(status.reasons).toContain('3 disconnects in last hour');
    });

    test('marks 403 Forbidden as high risk', () => {
      health.recordDisconnect(403);

      const status = health.getStatus();
      expect(status.risk).toBeGreaterThanOrEqual('medium' as any);
      expect(status.stats.forbiddenErrors).toBe(1);
    });

    test('marks 401 Logged Out as critical risk', () => {
      health.recordDisconnect(401);

      const status = health.getStatus();
      expect(status.risk).toBe('high');
      expect(status.reasons).toContain('Logged out by WhatsApp — possible temporary ban');
    });
  });

  describe('Failed message tracking', () => {
    test('tracks failed messages', () => {
      health.recordMessageFailed('Send error');
      health.recordMessageFailed('Timeout');

      const status = health.getStatus();
      expect(status.stats.failedMessagesLastHour).toBe(2);
    });

    test('escalates risk on many failed messages', () => {
      for (let i = 0; i < 5; i++) {
        health.recordMessageFailed('error');
      }

      const status = health.getStatus();
      expect(status.risk).toBeGreaterThanOrEqual('medium' as any);
    });
  });

  describe('Reachout timelock tracking', () => {
    test('tracks timelock errors', () => {
      health.recordReachoutTimelock('soft');

      const status = health.getStatus();
      expect(status.stats.timelockErrors).toBe(1);
      expect(status.score).toBeGreaterThan(0);
    });
  });

  describe('Risk level calculation', () => {
    test('starts at low risk', () => {
      const status = health.getStatus();
      expect(status.risk).toBe('low');
      expect(status.score).toBe(0);
    });

    test('escalates to medium on moderate issues', () => {
      // 3 disconnects should trigger medium
      for (let i = 0; i < 3; i++) {
        health.recordDisconnect('timeout');
      }

      const status = health.getStatus();
      expect(status.risk).toBe('medium');
      expect(status.score).toBeGreaterThanOrEqual(30);
    });

    test('escalates to high on serious issues', () => {
      // Multiple forbidden errors
      health.recordDisconnect(403);
      health.recordDisconnect(403);

      const status = health.getStatus();
      expect(status.risk).toBeGreaterThanOrEqual('high' as any);
    });

    test('escalates to critical on logged out', () => {
      health.recordDisconnect(401);

      const status = health.getStatus();
      expect(status.risk).toBeGreaterThanOrEqual('high' as any);
      expect(status.score).toBeGreaterThanOrEqual(60);
    });
  });

  describe('Auto-pause', () => {
    test('pauses when risk reaches autoPauseAt level', () => {
      // Trigger high risk (autoPauseAt is 'high')
      health.recordDisconnect(403);
      health.recordDisconnect(403);

      expect(health.isPaused()).toBe(true);
    });

    test('does not pause below autoPauseAt level', () => {
      health.recordDisconnect('timeout');

      expect(health.isPaused()).toBe(false);
    });
  });

  describe('Manual pause', () => {
    test('allows manual pause', () => {
      health.setPaused(true);
      expect(health.isPaused()).toBe(true);
    });

    test('allows manual resume', () => {
      health.setPaused(true);
      health.setPaused(false);
      expect(health.isPaused()).toBe(false);
    });
  });

  describe('Risk change notifications', () => {
    test('fires callback when risk level changes', () => {
      // Trigger risk change
      health.recordDisconnect(403);

      expect(riskChanges.length).toBeGreaterThan(0);
      expect(riskChanges[riskChanges.length - 1].risk).not.toBe('low');
    });
  });

  describe('Recommendations', () => {
    test('provides actionable recommendations', () => {
      const lowStatus = health.getStatus();
      expect(lowStatus.recommendation).toContain('normally');

      health.recordDisconnect(403);
      health.recordDisconnect(403);
      const highStatus = health.getStatus();
      expect(highStatus.recommendation).toBeTruthy();
    });
  });

  describe('Reset', () => {
    test('clears all tracked events', () => {
      health.recordDisconnect(403);
      health.recordMessageFailed('error');

      health.reset();

      const status = health.getStatus();
      expect(status.risk).toBe('low');
      expect(status.stats.disconnectsLastHour).toBe(0);
      expect(status.stats.failedMessagesLastHour).toBe(0);
    });
  });
});
