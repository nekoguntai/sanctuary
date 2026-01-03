/**
 * UI Slot System
 *
 * Provides extensible UI slots that can be filled with components.
 * This enables plugin-like functionality for the UI.
 *
 * ## Usage
 *
 * ### 1. Define a slot in your component:
 * ```tsx
 * import { Slot } from '../contexts/SlotContext';
 *
 * function WalletHeader({ wallet }) {
 *   return (
 *     <div className="header">
 *       <h1>{wallet.name}</h1>
 *       <Slot name="wallet-header-actions" context={{ wallet }} />
 *     </div>
 *   );
 * }
 * ```
 *
 * ### 2. Register a component for a slot:
 * ```tsx
 * import { useSlots } from '../contexts/SlotContext';
 *
 * function MyPlugin() {
 *   const { register } = useSlots();
 *
 *   useEffect(() => {
 *     const unregister = register('wallet-header-actions', {
 *       id: 'my-button',
 *       priority: 50,
 *       component: ({ wallet }) => (
 *         <button onClick={() => doSomething(wallet)}>
 *           My Action
 *         </button>
 *       ),
 *     });
 *     return unregister;
 *   }, [register]);
 *
 *   return null;
 * }
 * ```
 *
 * ## Predefined Slots
 *
 * - wallet-header-actions: Actions in wallet header
 * - wallet-detail-tabs: Additional tabs in wallet detail
 * - wallet-card-footer: Footer of wallet cards
 * - device-list-actions: Actions in device list header
 * - device-card-footer: Footer of device cards
 * - transaction-actions: Actions on transactions
 * - settings-sections: Additional settings sections
 * - dashboard-widgets: Dashboard widget area
 * - sidebar-footer: Bottom of sidebar
 * - navbar-actions: Navbar action buttons
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
  type ComponentType,
  type JSX,
} from 'react';

/**
 * Predefined slot names for type safety
 */
export const SlotNames = {
  WALLET_HEADER_ACTIONS: 'wallet-header-actions',
  WALLET_DETAIL_TABS: 'wallet-detail-tabs',
  WALLET_CARD_FOOTER: 'wallet-card-footer',
  DEVICE_LIST_ACTIONS: 'device-list-actions',
  DEVICE_CARD_FOOTER: 'device-card-footer',
  TRANSACTION_ACTIONS: 'transaction-actions',
  SETTINGS_SECTIONS: 'settings-sections',
  DASHBOARD_WIDGETS: 'dashboard-widgets',
  SIDEBAR_FOOTER: 'sidebar-footer',
  NAVBAR_ACTIONS: 'navbar-actions',
} as const;

export type SlotName = (typeof SlotNames)[keyof typeof SlotNames] | string;

/**
 * Registered slot component
 */
export interface SlotRegistration<TProps = Record<string, unknown>> {
  /** Unique identifier */
  id: string;
  /** Priority (lower = rendered earlier) */
  priority: number;
  /** The component to render */
  component: ComponentType<TProps>;
  /** Whether this registration is enabled */
  enabled?: boolean;
}

/**
 * Slot context value
 */
interface SlotContextValue {
  /** Register a component for a slot */
  register: <TProps = Record<string, unknown>>(
    slotName: SlotName,
    registration: SlotRegistration<TProps>
  ) => () => void;
  /** Unregister a component */
  unregister: (slotName: SlotName, id: string) => void;
  /** Get all registrations for a slot */
  getRegistrations: <TProps = Record<string, unknown>>(
    slotName: SlotName
  ) => SlotRegistration<TProps>[];
  /** Check if a slot has any registrations */
  hasSlot: (slotName: SlotName) => boolean;
}

const SlotContext = createContext<SlotContextValue | null>(null);

/**
 * Slot provider component
 */
export function SlotProvider({ children }: { children: ReactNode }) {
  const [registrations, setRegistrations] = useState<
    Map<SlotName, SlotRegistration[]>
  >(new Map());

  const register = useCallback(
    <TProps,>(
      slotName: SlotName,
      registration: SlotRegistration<TProps>
    ): (() => void) => {
      setRegistrations((prev) => {
        const current = prev.get(slotName) || [];
        const existing = current.findIndex((r) => r.id === registration.id);

        let updated: SlotRegistration[];
        if (existing >= 0) {
          // Replace existing
          updated = [...current];
          updated[existing] = registration as SlotRegistration;
        } else {
          // Add new and sort by priority
          updated = [...current, registration as SlotRegistration].sort(
            (a, b) => a.priority - b.priority
          );
        }

        const newMap = new Map(prev);
        newMap.set(slotName, updated);
        return newMap;
      });

      // Return unregister function
      return () => {
        setRegistrations((prev) => {
          const current = prev.get(slotName) || [];
          const updated = current.filter((r) => r.id !== registration.id);
          const newMap = new Map(prev);
          if (updated.length === 0) {
            newMap.delete(slotName);
          } else {
            newMap.set(slotName, updated);
          }
          return newMap;
        });
      };
    },
    []
  );

  const unregister = useCallback((slotName: SlotName, id: string) => {
    setRegistrations((prev) => {
      const current = prev.get(slotName) || [];
      const updated = current.filter((r) => r.id !== id);
      const newMap = new Map(prev);
      if (updated.length === 0) {
        newMap.delete(slotName);
      } else {
        newMap.set(slotName, updated);
      }
      return newMap;
    });
  }, []);

  const getRegistrations = useCallback(
    <TProps,>(slotName: SlotName): SlotRegistration<TProps>[] => {
      const slots = registrations.get(slotName) || [];
      return slots.filter((r) => r.enabled !== false) as SlotRegistration<TProps>[];
    },
    [registrations]
  );

  const hasSlot = useCallback(
    (slotName: SlotName): boolean => {
      const slots = registrations.get(slotName) || [];
      return slots.some((r) => r.enabled !== false);
    },
    [registrations]
  );

  const value = useMemo(
    () => ({
      register,
      unregister,
      getRegistrations,
      hasSlot,
    }),
    [register, unregister, getRegistrations, hasSlot]
  );

  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>;
}

/**
 * Hook to access slot functionality
 */
export function useSlots(): SlotContextValue {
  const context = useContext(SlotContext);
  if (!context) {
    throw new Error('useSlots must be used within a SlotProvider');
  }
  return context;
}

/**
 * Slot rendering component
 *
 * Renders all components registered for a slot name.
 */
export function Slot<TProps extends Record<string, unknown>>({
  name,
  context,
  wrapper: Wrapper,
  fallback,
}: {
  name: SlotName;
  context?: TProps;
  wrapper?: ComponentType<{ children: ReactNode }>;
  fallback?: ReactNode;
}): JSX.Element | null {
  const { getRegistrations, hasSlot } = useSlots();
  const slots = getRegistrations<TProps>(name);

  if (slots.length === 0) {
    return fallback ? <>{fallback}</> : null;
  }

  const content = slots.map((slot) => {
    const Component = slot.component;
    return <Component key={slot.id} {...(context || ({} as TProps))} />;
  });

  if (Wrapper) {
    return <Wrapper>{content}</Wrapper>;
  }

  return <>{content}</>;
}

/**
 * Hook to register a slot component
 * Returns true when ready (for rendering gates)
 */
export function useSlotRegistration<TProps = Record<string, unknown>>(
  slotName: SlotName,
  registration: Omit<SlotRegistration<TProps>, 'enabled'> & { enabled?: boolean }
): boolean {
  const { register } = useSlots();
  const [ready, setReady] = useState(false);

  React.useEffect(() => {
    const unregister = register(slotName, registration as SlotRegistration<TProps>);
    setReady(true);
    return () => {
      unregister();
      setReady(false);
    };
  }, [slotName, registration.id, registration.priority, register]);

  return ready;
}
