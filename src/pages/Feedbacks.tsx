/**
 * ─── Retours clients — partie Carburant ────────────────────────────────────────
 * Les avis déposés sur la page publique `/client` avec « Carburant » comme
 * partie concernée. Le tableau de bord est le même pour les trois parties
 * (voir `src/components/FeedbacksBoard.tsx`) : seuls les droits changent, ici
 * ceux du module de permissions « Retours Clients » de la station-service.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React from 'react';
import FeedbacksBoard from '../components/FeedbacksBoard';
import { useModulePermission } from '../store/AppContext';

export default function Feedbacks() {
  const perm = useModulePermission('Retours Clients');
  return (
    <FeedbacksBoard
      part="fuel"
      subtitle="Carburant"
      canModify={perm.modifier}
      canDelete={perm.supprimer}
    />
  );
}
