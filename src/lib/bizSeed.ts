/**
 * ─── FORME D'UN ÉTAT VIDE (aucune donnée constante) ────────────────────────────
 * Les parties Cafétéria et Magasin n'affichent QUE ce que contient la
 * ligne `biz_store` de Supabase. Ce fichier ne fournit donc plus que la FORME
 * d'un état — toutes les collections vides — pour que le store ait quelque chose
 * à rendre avant que la première lecture du serveur soit revenue.
 *
 * ─── POURQUOI LE JEU DE DÉMONSTRATION A DISPARU ────────────────────────────────
 * Ce fichier portait un jeu constant (produits, employés, clients, ventes,
 * interventions…) qui servait à peupler les écrans « prêts à l'emploi ». Il
 * RESSUSCITAIT ce que l'utilisateur venait de supprimer :
 *
 *   1. un poste ouvert sans copie locale (autre PC, autre navigateur, cache vidé)
 *      repartait de ce jeu constant ;
 *   2. la fusion le réunissait avec la copie du serveur — où les lignes avaient
 *      été supprimées — et la copie locale gagnait pour tout ce que le serveur
 *      ne connaissait plus ;
 *   3. l'envoi différé repoussait le tout : la suppression faite ailleurs était
 *      annulée, et les lignes de démonstration revenaient à l'écran.
 *
 * Une donnée qui n'existe nulle part ne peut plus revenir. Ce qu'il en reste dans
 * les copies déjà enregistrées est effacé par `purgeSeedRows`
 * (`src/store/BizContext.tsx`), local et serveur compris.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { BizState, ModuleState } from './bizConfig';

/** Une partie sans aucune ligne — toutes les collections de `ModuleState`. */
const emptyModule = (): ModuleState => ({
  categories: [], marques: [], roles: [], products: [], purchases: [], sales: [],
  clients: [], suppliers: [], workers: [], expenses: [], caisse: [], productions: [],
  fiches: [], comptoir: [], destructions: [], reparations: [],
  sessions: [], payRequests: [], inventaires: [], posPinned: [],
  messageTemplates: [], rappels: [],
});

/**
 * État de départ du store : les trois parties, vides. Tout ce qui s'affiche
 * ensuite vient de Supabase.
 */
export function emptyBizState(): BizState {
  return {
    restaurant: emptyModule(),
    cafeteria: emptyModule(),
    lavage: emptyModule(),
    magasin2: emptyModule(),
  };
}

export const EMPTY_MODULE = emptyModule;
