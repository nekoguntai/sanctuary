export interface PrioritizedRegistryEntry {
  /** Stable unique identifier used for lookup and duplicate checks. */
  readonly id: string;
  /** Higher values are ordered first. */
  readonly priority: number;
}

export interface RegistryDetectionResult {
  /** Whether the registry entry can handle the candidate input. */
  readonly detected: boolean;
  /** Higher-confidence results are ordered first in detectAll(). */
  readonly confidence: number;
}

export interface PrioritizedDetection<TEntry, TResult extends RegistryDetectionResult> {
  /** The registry entry that produced the detection result. */
  readonly entry: TEntry;
  /** Detection result returned by the entry-specific detector. */
  readonly result: TResult;
}

interface DetectFirstOptions<TEntry, TResult extends RegistryDetectionResult> {
  onDetected?: (entry: TEntry, result: TResult) => void;
  onError?: (entry: TEntry, error: unknown) => void;
}

/**
 * Small priority-ordered registry for extension points that dispatch by ID,
 * descending priority, and optional format detection.
 */
export class PrioritizedRegistry<TEntry extends PrioritizedRegistryEntry> {
  private entries: TEntry[] = [];

  constructor(private readonly entryLabel: string) {}

  /**
   * Register an entry and keep the registry sorted by descending priority.
   */
  register(entry: TEntry): void {
    if (this.get(entry.id)) {
      throw new Error(`${this.entryLabel} '${entry.id}' is already registered`);
    }

    this.entries.push(entry);
    this.entries.sort(compareByPriorityDesc);
  }

  /**
   * Remove an entry by ID.
   *
   * Returns false when the entry was not registered.
   */
  unregister(id: string): boolean {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1) return false;

    this.entries.splice(index, 1);
    return true;
  }

  /**
   * Get one registered entry by ID.
   */
  get(id: string): TEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  /**
   * Return registered entries in descending priority order.
   */
  getAll(): TEntry[] {
    return [...this.entries];
  }

  /**
   * Return the first entry whose detector returns detected: true.
   *
   * Detector exceptions are passed to onError, then detection continues.
   */
  detectFirst<TResult extends RegistryDetectionResult>(
    detect: (entry: TEntry) => TResult,
    options: DetectFirstOptions<TEntry, TResult> = {}
  ): TEntry | null {
    for (const entry of this.entries) {
      try {
        const result = detect(entry);
        if (result.detected) {
          options.onDetected?.(entry, result);
          return entry;
        }
      } catch (error) {
        options.onError?.(entry, error);
      }
    }

    return null;
  }

  /**
   * Return detection results for every entry, sorted by descending confidence.
   *
   * Detector exceptions are converted with fallbackResult so callers can keep
   * their domain-specific fallback shape.
   */
  detectAll<TResult extends RegistryDetectionResult>(
    detect: (entry: TEntry) => TResult,
    fallbackResult: (entry: TEntry, error: unknown) => TResult
  ): Array<PrioritizedDetection<TEntry, TResult>> {
    const results: Array<PrioritizedDetection<TEntry, TResult>> = [];

    for (const entry of this.entries) {
      try {
        results.push({ entry, result: detect(entry) });
      } catch (error) {
        results.push({ entry, result: fallbackResult(entry, error) });
      }
    }

    return results.sort((a, b) => b.result.confidence - a.result.confidence);
  }

  /**
   * Number of registered entries.
   */
  get count(): number {
    return this.entries.length;
  }
}

function compareByPriorityDesc<TEntry extends PrioritizedRegistryEntry>(a: TEntry, b: TEntry): number {
  return b.priority - a.priority;
}
