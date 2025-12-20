/**
 * Privacy Badge Component
 *
 * Displays a privacy score indicator for UTXOs.
 * Shows a color-coded shield icon based on privacy grade.
 */

import React from 'react';
import { Shield, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';

interface PrivacyBadgeProps {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  size?: 'sm' | 'md' | 'lg';
  showScore?: boolean;
  className?: string;
}

export const PrivacyBadge: React.FC<PrivacyBadgeProps> = ({
  score,
  grade,
  size = 'sm',
  showScore = false,
  className = '',
}) => {
  const sizeClasses = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  const gradeConfig = {
    excellent: {
      Icon: ShieldCheck,
      color: 'text-zen-matcha',
      bg: 'bg-zen-matcha/10',
      label: 'Excellent Privacy',
    },
    good: {
      Icon: Shield,
      color: 'text-zen-indigo',
      bg: 'bg-zen-indigo/10',
      label: 'Good Privacy',
    },
    fair: {
      Icon: ShieldAlert,
      color: 'text-zen-gold',
      bg: 'bg-zen-gold/10',
      label: 'Fair Privacy',
    },
    poor: {
      Icon: ShieldX,
      color: 'text-zen-vermilion',
      bg: 'bg-zen-vermilion/10',
      label: 'Poor Privacy',
    },
  };

  const config = gradeConfig[grade];
  const Icon = config.Icon;

  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`}
      title={`${config.label} (Score: ${score})`}
    >
      <span className={`${config.bg} ${config.color} p-0.5 rounded`}>
        <Icon className={sizeClasses[size]} />
      </span>
      {showScore && (
        <span className={`text-xs font-medium ${config.color}`}>
          {score}
        </span>
      )}
    </div>
  );
};

/**
 * Privacy Score Card
 * Detailed view of privacy factors
 */
interface PrivacyFactor {
  factor: string;
  impact: number;
  description: string;
}

interface PrivacyScoreCardProps {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  factors: PrivacyFactor[];
  warnings: string[];
}

export const PrivacyScoreCard: React.FC<PrivacyScoreCardProps> = ({
  score,
  grade,
  factors,
  warnings,
}) => {
  const gradeColors = {
    excellent: 'text-zen-matcha border-zen-matcha/30 bg-zen-matcha/5',
    good: 'text-zen-indigo border-zen-indigo/30 bg-zen-indigo/5',
    fair: 'text-zen-gold border-zen-gold/30 bg-zen-gold/5',
    poor: 'text-zen-vermilion border-zen-vermilion/30 bg-zen-vermilion/5',
  };

  return (
    <div className={`rounded-lg border p-3 ${gradeColors[grade]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium capitalize">{grade} Privacy</span>
        <span className="text-lg font-bold">{score}</span>
      </div>

      {factors.length > 0 && (
        <div className="space-y-1 text-xs">
          {factors.map((factor, idx) => (
            <div key={idx} className="flex justify-between">
              <span className="opacity-80">{factor.factor}</span>
              <span className={factor.impact < 0 ? 'text-zen-vermilion' : 'text-zen-matcha'}>
                {factor.impact > 0 ? '+' : ''}{factor.impact}
              </span>
            </div>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-2 pt-2 border-t border-current/20">
          {warnings.map((warning, idx) => (
            <p key={idx} className="text-xs opacity-80">
              {warning}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Wallet Privacy Summary
 * Overview of wallet-wide privacy metrics
 */
interface WalletPrivacySummaryProps {
  averageScore: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  addressReuseCount: number;
  roundAmountCount: number;
  clusterCount: number;
  recommendations: string[];
}

export const WalletPrivacySummary: React.FC<WalletPrivacySummaryProps> = ({
  averageScore,
  grade,
  addressReuseCount,
  roundAmountCount,
  clusterCount,
  recommendations,
}) => {
  return (
    <div className="surface-elevated rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
          Privacy Analysis
        </h4>
        <PrivacyBadge score={averageScore} grade={grade} size="md" showScore />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center p-2 rounded bg-sanctuary-50 dark:bg-sanctuary-800/50">
          <div className="text-lg font-bold text-sanctuary-900 dark:text-sanctuary-100">
            {addressReuseCount}
          </div>
          <div className="text-[10px] text-sanctuary-500">Reused Addresses</div>
        </div>
        <div className="text-center p-2 rounded bg-sanctuary-50 dark:bg-sanctuary-800/50">
          <div className="text-lg font-bold text-sanctuary-900 dark:text-sanctuary-100">
            {roundAmountCount}
          </div>
          <div className="text-[10px] text-sanctuary-500">Round Amounts</div>
        </div>
        <div className="text-center p-2 rounded bg-sanctuary-50 dark:bg-sanctuary-800/50">
          <div className="text-lg font-bold text-sanctuary-900 dark:text-sanctuary-100">
            {clusterCount}
          </div>
          <div className="text-[10px] text-sanctuary-500">Linked Clusters</div>
        </div>
      </div>

      {recommendations.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-sanctuary-500 mb-1">Recommendations</div>
          {recommendations.map((rec, idx) => (
            <p key={idx} className="text-xs text-sanctuary-600 dark:text-sanctuary-400">
              {rec}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};
