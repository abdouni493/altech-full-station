/**
 * ─── Retours clients d'une partie commerciale (Cafétéria / Lavage) ─────────────
 * Même écran que celui de la partie Carburant, filtré sur les avis déposés pour
 * CETTE partie. Les droits viennent de l'interface `feedbacks` de l'employé.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React from 'react';
import FeedbacksBoard from '@/src/components/FeedbacksBoard';
import { ModuleKey, MODULES } from '@/src/lib/bizConfig';
import { useBizPermission } from '@/src/store/AppContext';

export default function ModuleFeedbacks({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const perm = useBizPermission(moduleKey, 'feedbacks');
  return (
    <FeedbacksBoard
      part={moduleKey}
      subtitle={cfg.label}
      canModify={perm.modifier}
      canDelete={perm.supprimer}
    />
  );
}
