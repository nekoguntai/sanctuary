import { describe, expect, it } from 'vitest';

import {
  orderByDependencies,
  orderForShutdown,
  type ServiceLifecycleNode,
} from '../../../src/services/serviceLifecycleGraph';

describe('serviceLifecycleGraph', () => {
  const services: ServiceLifecycleNode[] = [
    { name: 'api', dependsOn: ['cache'] },
    { name: 'database' },
    { name: 'cache', dependsOn: ['database'] },
  ];

  it('orders services before their dependents', () => {
    expect(orderByDependencies(services).map(service => service.name)).toEqual([
      'database',
      'cache',
      'api',
    ]);
  });

  it('orders shutdown after dependents', () => {
    expect(orderForShutdown(services).map(service => service.name)).toEqual([
      'api',
      'cache',
      'database',
    ]);
  });

  it('throws when a dependency references a missing service', () => {
    expect(() => orderByDependencies([{ name: 'api', dependsOn: ['missing'] }])).toThrow(
      'Service api depends on missing service missing'
    );
  });

  it('throws on circular dependencies', () => {
    expect(() => orderByDependencies([
      { name: 'api', dependsOn: ['cache'] },
      { name: 'cache', dependsOn: ['api'] },
    ])).toThrow('Circular dependency detected');
  });

  it('throws on duplicate service names', () => {
    expect(() => orderByDependencies([
      { name: 'api' },
      { name: 'api' },
    ])).toThrow('Duplicate service name registered: api');
  });
});
