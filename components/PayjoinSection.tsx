/**
 * PayjoinSection Component
 *
 * Minimal Payjoin toggle for the receive modal with progressive disclosure.
 * Default: Simple toggle with help icon
 * On demand: Tooltip explains what Payjoin is, "Learn more" opens education modal
 */

import React, { useState, useEffect, useRef } from 'react';
import { Shield, HelpCircle, X, AlertCircle, Check, Clock, Lock, ExternalLink } from 'lucide-react';
import type { PayjoinEligibility, PayjoinEligibilityStatus } from '../src/api/payjoin';
import { checkPayjoinEligibility } from '../src/api/payjoin';

interface PayjoinSectionProps {
  walletId: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  className?: string;
}

// Status config for pills
const statusConfig: Record<PayjoinEligibilityStatus, {
  color: string;
  bgColor: string;
  icon: React.ElementType;
  label: string;
}> = {
  ready: {
    color: 'text-emerald-700 dark:text-emerald-300',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
    icon: Check,
    label: 'Ready',
  },
  'no-utxos': {
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: AlertCircle,
    label: 'No coins',
  },
  'pending-confirmations': {
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: Clock,
    label: 'Pending',
  },
  'all-frozen': {
    color: 'text-rose-700 dark:text-rose-300',
    bgColor: 'bg-rose-100 dark:bg-rose-900/30',
    icon: Lock,
    label: 'Frozen',
  },
  'all-locked': {
    color: 'text-cyan-700 dark:text-cyan-300',
    bgColor: 'bg-cyan-100 dark:bg-cyan-900/30',
    icon: Lock,
    label: 'Locked',
  },
  unavailable: {
    color: 'text-sanctuary-600 dark:text-sanctuary-400',
    bgColor: 'bg-sanctuary-100 dark:bg-sanctuary-800',
    icon: AlertCircle,
    label: 'Unavailable',
  },
};

export function PayjoinSection({ walletId, enabled, onToggle, className = '' }: PayjoinSectionProps) {
  const [eligibility, setEligibility] = useState<PayjoinEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showEducation, setShowEducation] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Fetch eligibility on mount
  useEffect(() => {
    const fetchEligibility = async () => {
      if (walletId) {
        setLoading(true);
        try {
          const result = await checkPayjoinEligibility(walletId);
          setEligibility(result);
        } catch {
          setEligibility(null);
        } finally {
          setLoading(false);
        }
      }
    };
    fetchEligibility();
  }, [walletId]);

  // Close tooltip on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        setShowTooltip(false);
      }
    }
    if (showTooltip) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showTooltip]);

  const isEligible = eligibility?.eligible ?? false;
  const status = eligibility?.status ?? 'unavailable';
  const statusCfg = statusConfig[status];
  const StatusIcon = statusCfg.icon;

  // Only show status pill when there's a problem
  const showStatusPill = !loading && !isEligible && eligibility;

  return (
    <div className={`relative ${className}`}>
      {/* Main row - minimal by default */}
      <div className="flex items-center justify-between p-3 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 surface-muted">
        <div className="flex items-center gap-2">
          <Shield className={`w-4 h-4 ${enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-sanctuary-400'}`} />
          <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
            Enhanced Privacy
          </span>

          {/* Help icon - reveals tooltip */}
          <button
            type="button"
            onClick={() => setShowTooltip(!showTooltip)}
            className="p-0.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors"
            aria-label="What is Payjoin?"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>

          {/* Status pill - only shown when unavailable */}
          {showStatusPill && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${statusCfg.bgColor} ${statusCfg.color}`}>
              <StatusIcon className="w-3 h-3" />
              {statusCfg.label}
            </span>
          )}
        </div>

        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={!isEligible && !enabled}
          onClick={() => onToggle(!enabled)}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            enabled
              ? 'bg-emerald-500 dark:bg-emerald-600'
              : isEligible
                ? 'bg-sanctuary-300 dark:bg-sanctuary-600'
                : 'bg-sanctuary-200 dark:bg-sanctuary-700 cursor-not-allowed'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
              enabled ? 'translate-x-5' : ''
            }`}
          />
        </button>
      </div>

      {/* Tooltip - appears on help click */}
      {showTooltip && (
        <div
          ref={tooltipRef}
          className="absolute left-0 right-0 mt-2 p-4 rounded-xl surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 shadow-lg z-20"
        >
          <div className="flex items-start justify-between mb-3">
            <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              What is Payjoin?
            </h4>
            <button
              onClick={() => setShowTooltip(false)}
              className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-sanctuary-600 dark:text-sanctuary-400 mb-3">
            Payjoin adds your coins to the sender's transaction, making it harder for
            chain analysis to track. The sender's wallet must support Payjoin (BIP78).
          </p>

          {/* Requirements */}
          <div className="text-xs text-sanctuary-500 dark:text-sanctuary-400 mb-3">
            <div className="font-medium mb-1">Requirements:</div>
            <ul className="list-disc list-inside space-y-0.5">
              <li>At least one confirmed coin in this wallet</li>
              <li>Your server must stay online until payment arrives</li>
            </ul>
          </div>

          {/* Reason if unavailable */}
          {eligibility?.reason && (
            <div className={`p-2 rounded-lg ${statusCfg.bgColor} mb-3`}>
              <p className={`text-xs ${statusCfg.color}`}>
                {eligibility.reason}
              </p>
            </div>
          )}

          <button
            onClick={() => {
              setShowTooltip(false);
              setShowEducation(true);
            }}
            className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
          >
            Learn more about Payjoin
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Note when enabled */}
      {enabled && (
        <p className="mt-2 text-xs text-sanctuary-500 dark:text-sanctuary-400">
          Keep your server running until payment arrives.
        </p>
      )}

      {/* Education Modal */}
      {showEducation && (
        <PayjoinEducationModal onClose={() => setShowEducation(false)} />
      )}
    </div>
  );
}

/**
 * Full education modal for users who want to learn more
 */
function PayjoinEducationModal({ onClose }: { onClose: () => void }) {
  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg surface-elevated rounded-2xl shadow-xl max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-sanctuary-100 dark:border-sanctuary-800 surface-elevated">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Understanding Payjoin
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* The Problem */}
          <section>
            <h3 className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              The Problem
            </h3>
            <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
              Bitcoin transactions are public. Chain analysis companies use a simple rule:
              "All inputs in a transaction probably belong to the same person." This lets
              them track your bitcoin across transactions.
            </p>

            {/* Simple diagram - normal tx */}
            <div className="mt-3 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
              <div className="text-xs font-medium text-rose-700 dark:text-rose-300 mb-2">
                Normal Transaction
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex flex-col gap-1">
                  <span className="px-2 py-1 bg-rose-100 dark:bg-rose-800/50 rounded text-rose-700 dark:text-rose-300">Sender's coin</span>
                  <span className="px-2 py-1 bg-rose-100 dark:bg-rose-800/50 rounded text-rose-700 dark:text-rose-300">Sender's coin</span>
                </div>
                <span className="text-rose-400">→</span>
                <span className="px-2 py-1 bg-rose-100 dark:bg-rose-800/50 rounded text-rose-700 dark:text-rose-300">Receiver</span>
              </div>
              <p className="mt-2 text-[10px] text-rose-600 dark:text-rose-400">
                ↑ Chain analysis assumes these are from the same person
              </p>
            </div>
          </section>

          {/* The Solution */}
          <section>
            <h3 className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              The Solution: Payjoin
            </h3>
            <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
              Payjoin breaks this assumption. When you receive with Payjoin enabled, you
              contribute one of your coins to the transaction. Now the inputs come from
              multiple people, breaking the chain analysis rule.
            </p>

            {/* Simple diagram - payjoin tx */}
            <div className="mt-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
              <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-2">
                Payjoin Transaction
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex flex-col gap-1">
                  <span className="px-2 py-1 bg-blue-100 dark:bg-blue-800/50 rounded text-blue-700 dark:text-blue-300">Sender's coin</span>
                  <span className="px-2 py-1 bg-emerald-100 dark:bg-emerald-800/50 rounded text-emerald-700 dark:text-emerald-300">Your coin</span>
                </div>
                <span className="text-emerald-400">→</span>
                <div className="flex flex-col gap-1">
                  <span className="px-2 py-1 bg-emerald-100 dark:bg-emerald-800/50 rounded text-emerald-700 dark:text-emerald-300">You (payment + your coin)</span>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-emerald-600 dark:text-emerald-400">
                ✓ Mixed inputs break the "same owner" assumption
              </p>
            </div>
          </section>

          {/* When to use */}
          <section>
            <h3 className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              When to Use It
            </h3>
            <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 space-y-1">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>Receiving payments you want to keep private</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>When the sender uses a Payjoin-capable wallet</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>When you have confirmed bitcoin available</span>
              </li>
            </ul>
          </section>

          {/* When it won't work */}
          <section>
            <h3 className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              When It Won't Work
            </h3>
            <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 space-y-1">
              <li className="flex items-start gap-2">
                <X className="w-4 h-4 text-sanctuary-400 mt-0.5 flex-shrink-0" />
                <span>If the sender's wallet doesn't support Payjoin</span>
              </li>
              <li className="flex items-start gap-2">
                <X className="w-4 h-4 text-sanctuary-400 mt-0.5 flex-shrink-0" />
                <span>If your server goes offline before they send</span>
              </li>
              <li className="flex items-start gap-2">
                <X className="w-4 h-4 text-sanctuary-400 mt-0.5 flex-shrink-0" />
                <span>If you have no confirmed coins to contribute</span>
              </li>
            </ul>
            <p className="mt-3 text-xs text-sanctuary-500 dark:text-sanctuary-400 p-3 rounded-lg bg-sanctuary-50 dark:bg-sanctuary-800/50">
              <strong>Don't worry:</strong> If Payjoin fails, the sender will still complete
              a normal payment. They won't even know Payjoin didn't happen.
            </p>
          </section>

          {/* External link */}
          <div className="pt-2">
            <a
              href="https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
            >
              Read the BIP78 specification
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PayjoinSection;
