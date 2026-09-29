/**
 * ─── CHOISIR UN CLIENT, PUIS SA VOITURE ────────────────────────────────────────
 *
 *  CE QUE CET ÉCRAN REMPLACE
 *  La fiche d'intervention proposait une simple liste déroulante de clients et
 *  cinq champs libres pour le véhicule. Deux défauts qui se payaient tous les
 *  jours :
 *
 *    • une liste déroulante de 400 clients ne se parcourt pas — l'employé
 *      abandonnait et enregistrait « Client de passage », donc la vente ne
 *      tombait sur aucun compte ;
 *    • le véhicule se retapait à chaque passage, avec sa plaque, sa couleur et
 *      son année. Trois orthographes plus tard, l'historique d'une voiture était
 *      éparpillé.
 *
 *  CE QU'IL FAIT
 *    1. On CHERCHE le client par nom OU par téléphone, et on le choisit dans une
 *       liste courte.
 *    2. Le client choisi, SES voitures s'affichent : on clique celle qui passe
 *       aujourd'hui. Un client qui n'en a qu'une la voit sélectionnée d'office —
 *       le cas le plus fréquent ne demande alors aucun geste.
 *    3. Le kilométrage se corrige ICI, au moment du passage. Le relevé remonte
 *       sur la fiche du client à l'enregistrement : c'est le seul endroit où on
 *       l'a réellement sous les yeux.
 *
 *  CE QU'IL NE CASSE PAS
 *  Le véhicule reste saisissable À LA MAIN — un client de passage n'a pas de
 *  fiche, et une voiture prêtée n'a pas à entrer dans le parc de quelqu'un. Les
 *  anciennes interventions, dont le véhicule n'a pas d'`id`, s'ouvrent et se
 *  modifient exactement comme avant.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import { Car, Check, Gauge, Search, UserPlus, X, Plus, Users } from 'lucide-react';
import { BizCar, BizContact, carLabel } from '@/src/lib/bizConfig';
import { matchesSearch } from '@/src/lib/utils';
import { Field, Input } from '@/src/components/biz/Kit';

/** Le libellé « Client de passage », identique à celui de la fiche. */
export const PASSAGE_LABEL = 'Client de passage';

/** Nombre de clients proposés d'un coup : au-delà, la liste cesse d'aider. */
const MAX_SUGGESTIONS = 30;

export function ClientCarPicker({
  clients, clientId, onClientId, car, onCar, onCreateClient, passageLabel = PASSAGE_LABEL,
}: {
  clients: BizContact[];
  clientId: string;
  onClientId: (id: string) => void;
  car: BizCar;
  onCar: (c: BizCar) => void;
  onCreateClient: () => void;
  passageLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  /** Le véhicule est saisi à la main : soit aucun client, soit un choix explicite. */
  const [manual, setManual] = useState(!car.id);

  const selected: BizContact | null = useMemo(
    () => clients.find(c => c.id === clientId) || null,
    [clients, clientId]);

  // Recherche par NOM ou par TÉLÉPHONE — c'est souvent le numéro qu'on a sous
  // la main quand le client appelle pour savoir si sa voiture est prête.
  const results: BizContact[] = useMemo(() => {
    const q = query.trim();
    if (!q) return clients.slice(0, MAX_SUGGESTIONS);
    return clients.filter(c => matchesSearch(q, c.name, c.phone)).slice(0, MAX_SUGGESTIONS);
  }, [clients, query]);

  const cars: BizCar[] = selected?.cars || [];

  /** Choisir un client : ses voitures prennent la main sur la saisie libre. */
  const pickClient = (c: BizContact | null) => {
    onClientId(c?.id || '');
    setOpen(false);
    setQuery('');
    if (!c) { setManual(true); return; }
    const list = c.cars || [];
    if (list.length === 1) {
      // Un seul véhicule : le cas courant ne doit demander aucun clic de plus.
      onCar({ ...list[0] });
      setManual(false);
    } else if (list.length > 1) {
      onCar({});
      setManual(false);
    } else {
      // Client sans parc enregistré : on garde la saisie libre, comme avant.
      setManual(true);
    }
  };

  const pickCar = (c: BizCar) => {
    // On COPIE la voiture dans l'intervention : la fiche gardera la trace de ce
    // qui est passé ce jour-là, même si le parc du client change ensuite.
    onCar({ ...c });
    setManual(false);
  };

  const isPicked = (c: BizCar) => !!c.id && car.id === c.id;

  return (
    <div className="space-y-3">
      {/* ── Le client ──────────────────────────────────────────────────────── */}
      <Field label="Client (optionnel)" hint={`Cherchez par nom ou par téléphone. Laissez vide pour un « ${passageLabel} ».`}>
        {selected ? (
          <div className="flex items-center gap-2 flex-wrap rounded-xl border-2 border-[#002d87]/20 bg-[#002d87]/5 px-3 py-2.5">
            <Users className="w-4 h-4 text-[#002d87] shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-[#002d87] truncate">{selected.name}</p>
              {selected.phone && <p className="text-[11px] font-semibold text-slate-500">{selected.phone}</p>}
            </div>
            <button type="button" className="btn-ghost !py-1 !px-2 text-xs shrink-0"
              onClick={() => pickClient(null)} title="Retirer le client">
              <X className="w-3.5 h-3.5" /> Changer
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                className="input-field pl-9"
                placeholder="Nom ou téléphone du client…"
                value={query}
                onChange={e => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)} />
            </div>
            <button type="button" className="btn-secondary !px-3 shrink-0" title="Créer un client"
              onClick={onCreateClient}><UserPlus className="w-4 h-4" /></button>
          </div>
        )}
      </Field>

      {!selected && open && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden max-h-64 overflow-y-auto custom-scrollbar">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-400 font-semibold">
              Aucun client ne correspond — l'intervention partira au nom d'un « {passageLabel} ».
            </div>
          ) : results.map((c: BizContact) => (
            <button key={c.id} type="button"
              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
              onClick={() => pickClient(c)}>
              <span className="text-sm font-bold text-slate-700">{c.name}</span>
              {c.phone && <span className="text-[11px] font-semibold text-slate-400 ml-2">{c.phone}</span>}
              {(c.cars?.length || 0) > 0 && (
                <span className="ml-2 text-[10px] font-black uppercase tracking-wider text-blue-500">
                  {c.cars!.length} véhicule{c.cars!.length > 1 ? 's' : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Ses voitures ───────────────────────────────────────────────────── */}
      {selected && cars.length > 0 && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[11px] font-black uppercase tracking-wider text-blue-800 flex items-center gap-1.5">
              <Car className="w-3.5 h-3.5" /> Véhicules de {selected.name}
            </p>
            <button type="button" className="text-[11px] font-black text-blue-600 hover:underline"
              onClick={() => { setManual(true); onCar({}); }}>
              <Plus className="w-3 h-3 inline" /> Un autre véhicule
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {cars.map((c: BizCar) => (
              <button key={c.id} type="button" onClick={() => pickCar(c)}
                className={`text-left rounded-xl border-2 px-3 py-2.5 transition ${
                  isPicked(c) ? 'border-[#002d87] bg-white shadow-sm' : 'border-transparent bg-white/70 hover:border-blue-300'
                }`}>
                <div className="flex items-center gap-2">
                  {isPicked(c)
                    ? <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    : <Car className="w-4 h-4 text-slate-300 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700 truncate">{carLabel(c) || 'Véhicule'}</p>
                    <p className="text-[11px] font-semibold text-slate-400 truncate">
                      {[c.color, c.year].filter(Boolean).join(' • ') || '—'}
                      {c.kilometrage ? ` • ${c.kilometrage.toLocaleString('fr-FR')} km` : ''}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {!manual && !car.id && (
            <p className="text-[11px] font-bold text-amber-700">
              Choisissez le véhicule qui passe aujourd'hui.
            </p>
          )}
        </div>
      )}

      {/* ── Le kilométrage du jour ─────────────────────────────────────────── */}
      {car.id && (
        <Field label="Kilométrage relevé aujourd'hui"
          hint="Il remplace celui de la fiche du client à l'enregistrement.">
          <div className="relative">
            <Gauge className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
            <Input type="number" inputMode="numeric" min={0} className="pl-9" placeholder="0"
              value={car.kilometrage ?? ''}
              onChange={e => onCar({
                ...car,
                kilometrage: e.target.value === '' ? undefined : Number(e.target.value) || 0,
              })} />
          </div>
        </Field>
      )}

      {/* ── La saisie libre — client de passage, ou véhicule hors parc ─────── */}
      {(manual || !selected) && (
        <div>
          <label className="label-field">
            Véhicule (optionnel){selected ? ' — hors parc du client' : ''}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Input placeholder="Nom / modèle" value={car.name || ''} onChange={e => onCar({ ...car, name: e.target.value })} />
            <Input placeholder="Marque" value={car.marque || ''} onChange={e => onCar({ ...car, marque: e.target.value })} />
            <Input placeholder="Couleur" value={car.color || ''} onChange={e => onCar({ ...car, color: e.target.value })} />
            <Input placeholder="Année" value={car.year || ''} onChange={e => onCar({ ...car, year: e.target.value })} />
            <Input placeholder="Immatriculation" value={car.immatriculation || ''} onChange={e => onCar({ ...car, immatriculation: e.target.value })} />
            <Input placeholder="Kilométrage" type="number" inputMode="numeric" min={0} value={car.kilometrage ?? ''}
              onChange={e => onCar({ ...car, kilometrage: e.target.value === '' ? undefined : Number(e.target.value) || 0 })} />
          </div>
          {selected && (
            <p className="text-[11px] font-semibold text-slate-400 mt-1.5">
              Ce véhicule n'entre pas dans le parc du client — ajoutez-le à sa fiche pour le
              retrouver au prochain passage.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
