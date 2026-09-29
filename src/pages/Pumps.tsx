import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Wrench,
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  Eye,
  TrendingUp,
  X,
  AlertTriangle,
  History,
  Printer,
  Zap,
  ToggleLeft,
  ToggleRight,
  Save
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, newId, orNull, matchesSearch } from "@/src/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import ChartBox from "../components/ChartBox";
import { useAppState, useAppDispatch, useModulePermission, Pump, PumpNozzle, FuelType, pumpTankIds, nozzleTankId, pumpsInCreationOrder } from "../store/AppContext";
import toast from "react-hot-toast";
import { ViewToggle, Table, Badge, RowActions, ActionBtn } from "@/src/components/biz/Kit";

const Pumps = () => {
  const { t } = useTranslation();
  const { pumps, tanks, pumpNozzles = [], brigades = [] } = useAppState();
  const dispatch = useAppDispatch();
  const perm = useModulePermission('Pompes');

  const [showModal, setShowModal] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [selectedPump, setSelectedPump] = useState<Pump | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  // Tableau par défaut : les pompes se lisent en lignes — cuves desservies,
  // pistolets, index. Les cartes restent à un clic.
  const [view, setView] = useState<"grid" | "table">("table");

  // Nozzle management state
  const [showNozzleModal, setShowNozzleModal] = useState(false);
  const [nozzlePump, setNozzlePump] = useState<Pump | null>(null);
  const [nozzleForm, setNozzleForm] = useState<{ name: string; lastIndex: number; tankId: string }>({ name: '', lastIndex: 0, tankId: '' });
  const [editingNozzle, setEditingNozzle] = useState<PumpNozzle | null>(null);
  const [detailTab, setDetailTab] = useState('overview');

  const [formData, setFormData] = useState<Partial<Pump>>({
    number: "",
    name: "",
    status: "Actif"
  });

  // A pump has no hand-picked fuel type anymore: the cuve is chosen per pistolet,
  // so the pump's cuve/type simply mirror its pistolets.
  const tankLabel = (id?: string) => tanks.find(t => t.id === id)?.name || "—";
  const pumpTanks = (pumpId: string) => pumpTankIds(pumpId, pumpNozzles, pumps)
    .map(id => tanks.find(t => t.id === id))
    .filter((t): t is typeof tanks[number] => !!t);

  /** Keeps `pump.tankId` / `pump.type` aligned with the pistolets of that pump. */
  const syncPumpFromNozzles = (pumpId: string, nozzles: PumpNozzle[]) => {
    const pump = pumps.find(p => p.id === pumpId);
    if (!pump) return;
    const firstTankId = nozzles
      .filter(n => n.pumpId === pumpId)
      .map(n => n.tankId || nozzleTankId(n, pumps))
      .find(Boolean);
    if (!firstTankId || firstTankId === pump.tankId) return;
    const tank = tanks.find(t => t.id === firstTankId);
    dispatch({ type: 'UPDATE_PUMP', payload: { ...pump, tankId: firstTankId, type: tank?.type } });
  };

  // Listed from the first created pompe to the last, like everywhere else.
  const filteredPumps = pumpsInCreationOrder(pumps).filter((p: Pump) =>
    matchesSearch(searchTerm, p.name, p.number)
  );

  const handleOpenAdd = () => {
    setSelectedPump(null);
    setFormData({
      number: `P${(pumps.length + 1).toString().padStart(2, '0')}`,
      name: "",
      status: "Actif"
    });
    setShowModal(true);
  };

  const handleOpenEdit = (pump: Pump) => {
    setSelectedPump(pump);
    setFormData(pump);
    setShowModal(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedPump) {
      dispatch({ type: 'UPDATE_PUMP', payload: formData as Pump });
      toast.success("Pompe mise à jour ✓");
    } else {
      const newPump = { ...formData, id: newId(), createdAt: new Date().toISOString() } as Pump;
      dispatch({ type: 'ADD_PUMP', payload: newPump });
      toast.success("Pompe ajoutée ✓");
    }
    setShowModal(false);
  };

  const handleDelete = () => {
    if (showDeleteConfirm) {
      // Une suppression refusée l'est par la base (contraintes de clé étrangère),
      // jamais par un identifiant écrit en dur : le garde-fou qui vivait ici
      // bloquait la pompe dont l'id valait littéralement « P1 ».
      dispatch({ type: 'DELETE_PUMP', payload: showDeleteConfirm });
      toast.success("Pompe supprimée ✓");
      setShowDeleteConfirm(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Actif": return "bg-green-100 text-green-700";
      case "Maintenance": return "bg-orange-100 text-orange-700";
      case "Hors service": return "bg-red-100 text-red-700";
      default: return "bg-slate-100 text-slate-700";
    }
  };

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-primary uppercase italic tracking-tight">Gestion des Pompes</h1>
          <p className="text-slate-500 font-medium">Configurez et suivez les index de vos pompes à carburant.</p>
        </div>
        {perm.creer && (
          <button
            onClick={handleOpenAdd}
            className="btn-primary h-14 px-8 tracking-[0.2em]"
          >
            <Plus className="w-4 h-4" /> AJOUTER UNE POMPE
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative w-full max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input 
          type="text" 
          placeholder="Rechercher une pompe..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-3 bg-white border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all outline-none font-medium"
        />
      </div>
      <div className="flex justify-end -mt-4"><ViewToggle view={view} onChange={setView} /></div>

      {/* Pump list — tableau par défaut, cartes à un clic */}
      {filteredPumps.length === 0 ? (
        <div className="card-glass p-16 text-center">
          <Wrench className="w-16 h-16 text-slate-200 mx-auto mb-4" />
          <p className="text-slate-500 font-medium">Aucune pompe trouvée</p>
        </div>
      ) : view === "table" ? (
        /* ── Le parc de pompes en tableau ─────────────────────────────────
           Ce que la carte raconte, en colonnes : quelles cuves la pompe
           dessert, combien de pistolets elle porte et où en sont leurs index
           — c'est ce dernier chiffre qu'on vient vérifier ici. */
        <Table head={<>
          <th className="table-head">Pompe</th><th className="table-head">Nom</th>
          <th className="table-head">Cuves desservies</th><th className="table-head">Pistolets</th>
          <th className="table-head text-right">Index cumulé</th>
          <th className="table-head">Statut</th><th className="table-head text-right">Actions</th>
        </>}>
          {filteredPumps.map(pump => {
            const cuves = pumpTanks(pump.id);
            const nozzles = pumpNozzles.filter(n => n.pumpId === pump.id);
            const totalIndex = nozzles.reduce((s, n) => s + (n.lastIndex || 0), 0);
            return (
              <tr key={pump.id}>
                <td className="table-cell font-black text-primary uppercase">{pump.number}</td>
                <td className="table-cell">{pump.name}</td>
                <td className="table-cell">
                  {cuves.length === 0
                    ? <span className="text-slate-400">Aucune — définissez-la sur les pistolets</span>
                    : <div className="flex flex-wrap gap-1 max-w-[240px]">
                      {cuves.map(c => <Badge key={c.id} tone="info">{c.name} · {c.type}</Badge>)}
                    </div>}
                </td>
                <td className="table-cell">
                  {nozzles.length === 0
                    ? <span className="text-slate-400">Aucun</span>
                    : <div className="space-y-0.5 max-w-[280px]">
                      {nozzles.map(n => (
                        <div key={n.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", n.status === 'Actif' ? 'bg-green-400' : 'bg-slate-300')} />
                            <span className="font-bold text-slate-700 truncate">{n.name}</span>
                            <span className="text-slate-400 truncate">· {tankLabel(nozzleTankId(n, pumps))}</span>
                          </span>
                          <span className="font-black text-purple-700 tabular-nums shrink-0">
                            {n.lastIndex.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} L
                          </span>
                        </div>
                      ))}
                    </div>}
                </td>
                <td className="table-cell tabular-nums text-right font-black text-purple-700">
                  {totalIndex.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} L
                </td>
                <td className="table-cell">
                  <Badge tone={pump.status === "Actif" ? "success" : pump.status === "Maintenance" ? "warning" : "danger"}>
                    {pump.status}
                  </Badge>
                </td>
                <td className="table-cell text-right">
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Voir la pompe" onClick={() => { setSelectedPump(pump); setDetailTab('overview'); setShowDetail(true); }} />
                    {perm.modifier && <ActionBtn icon={Zap} tone="slate" title="Gérer les pistolets"
                      onClick={() => { setNozzlePump(pump); setNozzleForm({ name: '', lastIndex: 0, tankId: pump.tankId || tanks[0]?.id || '' }); setEditingNozzle(null); setShowNozzleModal(true); }} />}
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => handleOpenEdit(pump)} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setShowDeleteConfirm(pump.id)} />}
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <motion.div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPumps.map((pump, index) => {
            const cuves = pumpTanks(pump.id);
            return (
              <motion.div
                key={pump.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25, delay: index * 0.04 }}
                className="relative bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all group overflow-hidden"
              >
                {/* Gradient Top Border */}
                <div className="h-1.5 absolute top-0 left-0 right-0 bg-gradient-to-r from-blue-600 via-blue-500 to-yellow-400" />
                
                <div className="p-6 space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-black text-primary uppercase">{pump.number}</h3>
                      </div>
                      <p className="text-sm text-slate-600 font-bold">{pump.name}</p>
                    </div>
                    <span className={cn("px-2.5 py-1.5 rounded-full text-[9px] font-black uppercase whitespace-nowrap", 
                      pump.status === "Actif" ? "bg-green-100 text-green-700" :
                      pump.status === "Maintenance" ? "bg-orange-100 text-orange-700" : "bg-red-100 text-red-700"
                    )}>
                      {pump.status}
                    </span>
                  </div>

                  {/* Information Grid */}
                  <div className="space-y-3 pt-2 border-t border-slate-100">
                    {/* Cuves served — derived from the pistolets of this pump */}
                    <div className="p-3 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl border border-blue-100">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">🪣 Cuves desservies</p>
                      {cuves.length === 0 ? (
                        <p className="text-sm font-bold text-slate-400">Aucune — définissez-la sur les pistolets</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {cuves.map(c => (
                            <span key={c.id} className="px-2 py-0.5 rounded-full bg-white border border-blue-200 text-[10px] font-bold text-primary">
                              {c.name} <span className="text-slate-400 italic">{c.type}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Per-nozzle indexes */}
                    {(() => {
                      const nozzles = pumpNozzles.filter(n => n.pumpId === pump.id);
                      if (nozzles.length === 0) return (
                        <div className="p-3 bg-gradient-to-br from-purple-50 to-violet-50 rounded-2xl border border-purple-100">
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">🔫 Aucun pistolet configuré</p>
                        </div>
                      );
                      return (
                        <div className="p-3 bg-gradient-to-br from-purple-50 to-violet-50 rounded-2xl border border-purple-100">
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">🔫 Index Pistolets</p>
                          <div className="space-y-1.5">
                            {nozzles.map(n => (
                              <div key={n.id} className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", n.status === 'Actif' ? 'bg-green-400' : 'bg-slate-300')} />
                                  <span className="text-[10px] font-bold text-slate-700 truncate">{n.name}</span>
                                  <span className="text-[9px] text-slate-400 truncate">· {tankLabel(nozzleTankId(n, pumps))}</span>
                                </div>
                                <span className="text-[11px] font-black text-purple-700 tabular-nums ml-2 flex-shrink-0">
                                  {n.lastIndex.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} L
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Actions */}
                  <div className="pt-2 border-t border-slate-100 flex gap-2">
                    <button
                      onClick={() => { setSelectedPump(pump); setDetailTab('overview'); setShowDetail(true); }}
                      className="flex-1 py-2.5 rounded-xl font-bold text-[9px] uppercase tracking-widest bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                      <Eye className="w-4 h-4 mx-auto" />
                    </button>
                    {perm.modifier && (
                      <button
                        onClick={() => { setNozzlePump(pump); setNozzleForm({ name: '', lastIndex: 0, tankId: pump.tankId || tanks[0]?.id || '' }); setEditingNozzle(null); setShowNozzleModal(true); }}
                        className="flex-1 py-2.5 rounded-xl font-bold text-[9px] uppercase tracking-widest bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
                        title="Gérer les pistolets"
                      >
                        <Zap className="w-4 h-4 mx-auto" />
                      </button>
                    )}
                    {perm.modifier && (
                      <button
                        onClick={() => handleOpenEdit(pump)}
                        className="flex-1 py-2.5 rounded-xl font-bold text-[9px] uppercase tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                      >
                        <Edit2 className="w-4 h-4 mx-auto" />
                      </button>
                    )}
                    {perm.supprimer && (
                      <button
                        onClick={() => setShowDeleteConfirm(pump.id)}
                        className="flex-1 py-2.5 rounded-xl font-bold text-[9px] uppercase tracking-widest bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                      >
                        <Trash2 className="w-4 h-4 mx-auto" />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="modal-shell z-[60]">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[var(--modal-max-h)] border border-slate-100"
            >
              {/* Header with sidebar colors */}
              <div className="p-6 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white flex justify-between items-center shrink-0">
                <div>
                  <h3 className="font-black text-xs uppercase tracking-widest italic flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-yellow-400" />
                    {selectedPump ? "MODIFIER LA POMPE" : "NOUVELLE POMPE"}
                  </h3>
                  <p className="text-[10px] text-yellow-300 font-bold mt-1">
                    {selectedPump ? "Mise à jour des informations de la pompe" : "Configuration d'une nouvelle pompe"}
                  </p>
                </div>
                <button onClick={() => setShowModal(false)} className="hover:bg-white/20 p-2 rounded-lg transition-all"><X className="w-6 h-6" /></button>
              </div>

              {/* Form */}
              <form onSubmit={handleSave} className="p-8 space-y-6 text-left overflow-y-auto custom-scrollbar">
                {/* Basic Info Section */}
                <div className="space-y-3">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">📋 Information de Base</p>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">📝 Nom de la pompe</label>
                    <input 
                      type="text" 
                      required
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none font-medium transition-all" 
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      placeholder="Nom de la pompe (ex: Pompe Diesel 1)"
                    />
                  </div>
                </div>

                {/* Configuration — a pump has no fuel type: it comes from the
                    cuve chosen on each of its pistolets. */}
                <div className="space-y-3">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">⚙️ Configuration</p>
                  <div className="space-y-2 p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-100">
                    <label className="text-[10px] font-bold text-green-700 uppercase tracking-widest block">✅ Statut</label>
                    <select
                      className="w-full px-3 py-2 bg-white border border-green-200 rounded-lg focus:ring-2 focus:ring-green-400 focus:border-transparent outline-none font-medium text-sm"
                      value={formData.status}
                      onChange={e => setFormData({...formData, status: e.target.value as any})}
                    >
                      <option>Actif</option>
                      <option>Maintenance</option>
                      <option>Hors service</option>
                    </select>
                  </div>
                  <div className="p-4 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl border border-blue-100">
                    <p className="text-[10px] font-bold text-blue-700 uppercase tracking-widest">🪣 Cuves</p>
                    <p className="text-xs text-slate-500 mt-1">
                      La cuve se choisit sur chaque pistolet de la pompe
                      {selectedPump ? " (bouton « Pistolets »)." : ", après la création de la pompe."}
                    </p>
                    {selectedPump && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {pumpTanks(selectedPump.id).map(c => (
                          <span key={c.id} className="px-2 py-0.5 rounded-full bg-white border border-blue-200 text-[10px] font-bold text-primary">
                            {c.name} <span className="text-slate-400 italic">{c.type}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <button type="submit" id="submit-button-pump" className="hidden"></button>
              </form>

              {/* Footer */}
              <div className="p-6 bg-gradient-to-r from-slate-50 to-yellow-50 border-t border-slate-200 flex gap-4 shrink-0">
                <button onClick={() => setShowModal(false)} className="flex-1 text-[10px] font-black uppercase text-blue-900 italic hover:text-blue-800 transition-colors border-2 border-blue-900 rounded-lg py-3 hover:bg-white bg-gradient-to-r from-white to-yellow-50">
                  Annuler
                </button>
                <button onClick={() => document.getElementById('submit-button-pump')?.click()} className="flex-[2] bg-gradient-to-r from-blue-900 to-blue-800 hover:shadow-lg text-white font-black uppercase tracking-widest rounded-lg py-3 transition-all transform hover:-translate-y-0.5 text-[10px]">
                  ENREGISTRER LA POMPE
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="modal-shell z-[70] text-center">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setShowDeleteConfirm(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white p-8 rounded-3xl shadow-2xl relative z-10 w-full max-w-md border-2 border-red-100"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-red-100 to-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-black text-primary mb-2 uppercase tracking-tight">Supprimer la pompe ?</h3>
              <p className="text-slate-600 mb-8 text-sm px-4 font-medium">Êtes-vous sûr de vouloir supprimer cette pompe ? Les données historiques seront archivées.</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowDeleteConfirm(null)} 
                  className="flex-1 py-3 font-bold text-slate-600 uppercase text-[10px] tracking-widest rounded-xl hover:bg-slate-100 transition-colors border border-slate-200"
                >
                  ANNULER
                </button>
                <button 
                  onClick={handleDelete} 
                  className="flex-1 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:from-red-600 hover:to-red-700 transition-all active:scale-95 shadow-lg shadow-red-200/50"
                >
                  SUPPRIMER
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail View Modal */}
      <AnimatePresence>
        {showDetail && selectedPump && (() => {
          const nozzles = pumpNozzles.filter(n => n.pumpId === selectedPump.id);
          const cuves = pumpTanks(selectedPump.id);
          const tank = cuves[0];
          const fuelType = tank?.type;
          const tankFill = tank && tank.capacity > 0 ? Math.min(Math.round((tank.current / tank.capacity) * 100), 100) : 0;

          const fuelBg = fuelType === 'SUPER' || fuelType === 'ESSENCE' ? 'bg-blue-100' :
                         fuelType === 'DIESEL' || fuelType === 'GASOIL' ? 'bg-green-100' : 'bg-orange-100';
          const fuelText = fuelType === 'SUPER' || fuelType === 'ESSENCE' ? 'text-blue-700' :
                           fuelType === 'DIESEL' || fuelType === 'GASOIL' ? 'text-green-700' : 'text-orange-700';

          const pumpHistory = brigades
            .filter(b =>
              (b.status === 'Clôturée' || b.status === 'Fermée') &&
              b.startIndices?.[selectedPump.id] !== undefined &&
              b.endIndices?.[selectedPump.id] !== undefined
            )
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 20)
            .map(b => ({
              date: b.date,
              shift: b.shift,
              startIndex: b.startIndices![selectedPump.id],
              endIndex: b.endIndices![selectedPump.id],
              liters: (b.endIndices![selectedPump.id]) - (b.startIndices![selectedPump.id])
            }));

          const chartData = pumpHistory.slice(0, 12).reverse().map(h => ({
            label: `${new Date(h.date).getDate()}/${new Date(h.date).getMonth() + 1}`,
            liters: Math.max(0, h.liters)
          }));

          const TABS = [
            { id: 'overview', label: "Vue d'ensemble", icon: Eye },
            { id: 'nozzles',  label: `Pistolets (${nozzles.length})`, icon: Zap },
            { id: 'history',  label: 'Historique', icon: History },
          ];

          return (
            <div className="modal-shell z-[60]">
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowDetail(false)}
                className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-white w-full max-w-5xl rounded-[2rem] shadow-2xl relative z-10 flex flex-col overflow-hidden max-h-[var(--modal-max-h)] border border-slate-100"
              >
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white px-6 py-5 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                         style={{ background: 'rgba(255,184,0,0.2)', border: '1px solid rgba(255,184,0,0.3)' }}>
                      <Wrench className="w-5 h-5 text-yellow-400" />
                    </div>
                    <div>
                      <h3 className="font-black text-sm uppercase tracking-widest italic leading-none">{selectedPump.name}</h3>
                      <p className="text-[10px] text-blue-200 font-bold mt-1">{selectedPump.number} · {cuves.map(c => c.name).join(', ') || 'Aucune cuve'} · {selectedPump.status}</p>
                    </div>
                  </div>
                  <button onClick={() => setShowDetail(false)} className="hover:bg-white/20 p-2 rounded-lg transition-all"><X className="w-5 h-5" /></button>
                </div>

                {/* Body */}
                <div className="flex flex-1 overflow-hidden">
                  {/* Left sidebar nav */}
                  <div className="w-44 shrink-0 flex flex-col"
                       style={{ background: 'linear-gradient(170deg, #001233 0%, #001f5c 35%, #003087 70%, #002470 100%)' }}>
                    <div className="px-3 py-4 space-y-0.5">
                      {TABS.map(tab => {
                        const Icon = tab.icon;
                        const isActive = detailTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            onClick={() => setDetailTab(tab.id)}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all",
                              isActive
                                ? "font-black shadow-lg"
                                : "text-blue-200 hover:bg-white/10 font-semibold"
                            )}
                            style={isActive ? { background: '#FFB800', color: '#001233' } : {}}
                          >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <span className="text-[11px] leading-tight">{tab.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Status chip */}
                    <div className="mt-auto p-3 border-t border-white/10">
                      <div className={cn("px-2 py-2 rounded-xl text-center",
                        selectedPump.status === 'Actif' ? 'bg-green-500/20' :
                        selectedPump.status === 'Maintenance' ? 'bg-orange-500/20' : 'bg-red-500/20'
                      )}>
                        <div className={cn("w-2 h-2 rounded-full mx-auto mb-1 animate-pulse",
                          selectedPump.status === 'Actif' ? 'bg-green-400' :
                          selectedPump.status === 'Maintenance' ? 'bg-orange-400' : 'bg-red-400'
                        )} />
                        <p className={cn("text-[9px] font-black uppercase tracking-widest",
                          selectedPump.status === 'Actif' ? 'text-green-300' :
                          selectedPump.status === 'Maintenance' ? 'text-orange-300' : 'text-red-300'
                        )}>{selectedPump.status}</p>
                      </div>
                    </div>
                  </div>

                  {/* Content panel */}
                  <div className="flex-1 overflow-y-auto bg-slate-50 custom-scrollbar">
                    <AnimatePresence mode="wait">

                      {/* ── Overview Tab ── */}
                      {detailTab === 'overview' && (
                        <motion.div key="overview" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                          className="p-6 space-y-5">

                          {/* KPI row */}
                          <div className="grid grid-cols-3 gap-4">
                            <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Index Actuel</p>
                              <p className="text-2xl font-black text-blue-900 leading-none tabular-nums">
                                {selectedPump.lastIndex.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                              <p className="text-[10px] text-slate-400 font-bold mt-1">Litres</p>
                            </div>
                            <div className={cn("rounded-2xl border p-4 shadow-sm", fuelBg, 'border-current/20')}>
                              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Carburant</p>
                              <p className={cn("text-2xl font-black leading-none", fuelText)}>{fuelType || '—'}</p>
                              <p className="text-[10px] text-slate-500 font-bold mt-1">{nozzles.length} pistolet{nozzles.length !== 1 ? 's' : ''}</p>
                            </div>
                            <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Pistolets Actifs</p>
                              <p className="text-2xl font-black text-purple-700 leading-none">{nozzles.filter(n => n.status === 'Actif').length}</p>
                              <p className="text-[10px] text-slate-400 font-bold mt-1">/ {nozzles.length} total</p>
                            </div>
                          </div>

                          {/* Tank card */}
                          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                            <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 px-5 py-3 flex items-center gap-3">
                              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                                   style={{ background: 'rgba(255,184,0,0.2)', border: '1px solid rgba(255,184,0,0.3)' }}>
                                <span className="text-yellow-400 text-xs">🪣</span>
                              </div>
                              <p className="text-white font-black text-xs uppercase tracking-widest">Cuve Associée</p>
                            </div>
                            <div className="p-5">
                              {tank ? (
                                <div className="space-y-4">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <p className="font-black text-blue-900 text-lg leading-none">{tank.name}</p>
                                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{tank.type}</p>
                                    </div>
                                    <span className={cn("px-3 py-1 rounded-full text-[9px] font-black uppercase", fuelBg, fuelText)}>{tank.type}</span>
                                  </div>
                                  <div>
                                    <div className="flex justify-between mb-1.5">
                                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Niveau</span>
                                      <span className="text-[10px] font-black text-blue-900 tabular-nums">
                                        {tank.current.toLocaleString('fr-FR')} L / {tank.capacity.toLocaleString('fr-FR')} L
                                      </span>
                                    </div>
                                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                                      <div className={cn("h-full rounded-full transition-all",
                                        tankFill > 50 ? 'bg-green-400' : tankFill > 25 ? 'bg-orange-400' : 'bg-red-400'
                                      )} style={{ width: `${tankFill}%` }} />
                                    </div>
                                    <div className="flex justify-between mt-1.5">
                                      <span className="text-[9px] text-slate-400 font-bold">{tankFill}% plein</span>
                                      {tankFill < 20 && <span className="text-[9px] text-red-500 font-black">⚠ Niveau bas</span>}
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100">
                                    <div className="text-center p-2.5 bg-slate-50 rounded-xl">
                                      <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Capacité</p>
                                      <p className="font-black text-slate-700 text-sm">{tank.capacity.toLocaleString('fr-FR')} L</p>
                                    </div>
                                    <div className="text-center p-2.5 bg-slate-50 rounded-xl">
                                      <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Jaugeage</p>
                                      <p className="font-black text-slate-700 text-sm">{tank.degrees}{tank.type === 'GPL' ? '%' : ' °'}</p>
                                    </div>
                                    <div className="text-center p-2.5 bg-slate-50 rounded-xl">
                                      <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Seuil Alerte</p>
                                      <p className="font-black text-slate-700 text-sm">{tank.alertThreshold.toLocaleString('fr-FR')} L</p>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-slate-400 text-sm font-medium text-center py-4">Aucune cuve associée</p>
                              )}
                            </div>
                          </div>

                        </motion.div>
                      )}

                      {/* ── Nozzles Tab ── */}
                      {detailTab === 'nozzles' && (
                        <motion.div key="nozzles" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                          className="p-6 space-y-4">
                          {nozzles.length === 0 ? (
                            <div className="text-center py-20">
                              <Zap className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                              <p className="text-slate-400 font-medium">Aucun pistolet configuré</p>
                              <p className="text-slate-300 text-xs mt-1">Utilisez le bouton ⚡ sur la carte pompe pour en ajouter</p>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                                  {nozzles.length} pistolet{nozzles.length !== 1 ? 's' : ''} configuré{nozzles.length !== 1 ? 's' : ''}
                                </p>
                                <div className="flex gap-3">
                                  <span className="flex items-center gap-1 text-[10px] font-bold text-green-600">
                                    <span className="w-2 h-2 bg-green-400 rounded-full" />Actif: {nozzles.filter(n => n.status === 'Actif').length}
                                  </span>
                                  <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                                    <span className="w-2 h-2 bg-slate-300 rounded-full" />Inactif: {nozzles.filter(n => n.status === 'Inactif').length}
                                  </span>
                                </div>
                              </div>

                              <div className="space-y-3">
                                {nozzles.map(nozzle => {
                                  const vol = nozzle.lastIndex - nozzle.startIndex;
                                  return (
                                    <div key={nozzle.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                      <div className="flex items-center gap-3 p-4">
                                        <div className={cn("w-1.5 self-stretch rounded-full flex-shrink-0 min-h-[36px]",
                                          nozzle.status === 'Actif' ? 'bg-green-400' : 'bg-slate-300'
                                        )} />
                                        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-purple-100 flex-shrink-0">
                                          <Zap className="w-4 h-4 text-purple-600" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="font-black text-slate-800 truncate">{nozzle.name}</p>
                                          <span className={cn("text-[9px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full inline-block mt-0.5",
                                            nozzle.status === 'Actif' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                                          )}>{nozzle.status}</span>
                                        </div>
                                      </div>
                                      <div className="px-4 pb-4 grid grid-cols-3 gap-2">
                                        <div className="bg-slate-50 rounded-xl p-3 text-center">
                                          <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Index Départ</p>
                                          <p className="font-black text-slate-700 text-sm tabular-nums">{nozzle.startIndex.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                          <p className="text-[9px] text-slate-400">L</p>
                                        </div>
                                        <div className="bg-blue-50 rounded-xl p-3 text-center border border-blue-100">
                                          <p className="text-[9px] text-blue-600 font-bold uppercase mb-1">Index Actuel</p>
                                          <p className="font-black text-blue-900 text-sm tabular-nums">{nozzle.lastIndex.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                          <p className="text-[9px] text-blue-400">L</p>
                                        </div>
                                        <div className="bg-purple-50 rounded-xl p-3 text-center border border-purple-100">
                                          <p className="text-[9px] text-purple-600 font-bold uppercase mb-1">Volume Total</p>
                                          <p className="font-black text-purple-700 text-sm tabular-nums">{vol.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                          <p className="text-[9px] text-purple-400">L</p>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </motion.div>
                      )}

                      {/* ── History Tab ── */}
                      {detailTab === 'history' && (
                        <motion.div key="history" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                          className="p-6 space-y-5">
                          {pumpHistory.length === 0 ? (
                            <div className="text-center py-20">
                              <History className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                              <p className="text-slate-400 font-medium">Aucun historique disponible</p>
                              <p className="text-slate-300 text-xs mt-1">L'historique apparaît après la clôture des brigades</p>
                            </div>
                          ) : (
                            <>
                              {/* Chart */}
                              {chartData.length > 0 && (
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <TrendingUp className="w-4 h-4 text-blue-600" /> Volumes par Brigade
                                  </h4>
                                  <ChartBox height={200}>
                                    <BarChart data={chartData}>
                                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                                      <Tooltip
                                        contentStyle={{ borderRadius: '12px', border: '2px solid #003087', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontWeight: 'bold', fontSize: 12 }}
                                        cursor={{ fill: 'rgba(26, 60, 110, 0.04)' }}
                                        formatter={(v: number) => [`${v.toFixed(2)} L`, 'Volume']}
                                      />
                                      <Bar dataKey="liters" fill="#003087" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                  </ChartBox>
                                </div>
                              )}

                              {/* Table */}
                              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 px-5 py-3">
                                  <p className="text-white font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                    <History className="w-3.5 h-3.5 text-yellow-400" /> Relevés par Brigade
                                  </p>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left">
                                    <thead className="bg-slate-50 border-b border-slate-100">
                                      <tr>
                                        <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                                        <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Quart</th>
                                        <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Index Début</th>
                                        <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Index Fin</th>
                                        <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Volume</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                      {pumpHistory.map((h, idx) => (
                                        <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                                          <td className="px-4 py-3 font-bold text-slate-700 text-[11px]">
                                            {new Date(h.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                                          </td>
                                          <td className="px-4 py-3">
                                            <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-black uppercase",
                                              h.shift === 'Matin' ? 'bg-yellow-100 text-yellow-700' :
                                              h.shift === 'Soir'  ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700'
                                            )}>{h.shift}</span>
                                          </td>
                                          <td className="px-4 py-3 font-mono text-[11px] text-slate-500 tabular-nums">
                                            {h.startIndex.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </td>
                                          <td className="px-4 py-3 font-mono text-[11px] text-slate-500 tabular-nums">
                                            {h.endIndex.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </td>
                                          <td className="px-4 py-3">
                                            <span className={cn("font-black text-[11px] tabular-nums",
                                              h.liters >= 0 ? 'text-blue-700' : 'text-red-600'
                                            )}>
                                              {h.liters >= 0 ? '+' : ''}{h.liters.toFixed(2)} L
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </>
                          )}
                        </motion.div>
                      )}

                    </AnimatePresence>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-yellow-50 border-t border-slate-200 flex gap-3 shrink-0">
                  <button className="flex items-center gap-2 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-blue-900 border-2 border-blue-900 rounded-xl hover:bg-blue-50 transition-colors bg-white">
                    <Printer className="w-4 h-4" /> Imprimer
                  </button>
                  <button onClick={() => setShowDetail(false)}
                    className="flex-1 bg-gradient-to-r from-blue-900 to-blue-800 hover:shadow-lg text-white font-black uppercase tracking-widest rounded-xl py-2.5 transition-all hover:-translate-y-0.5 text-[10px]">
                    FERMER
                  </button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* Nozzle Management Modal */}
      <AnimatePresence>
        {showNozzleModal && nozzlePump && (() => {
          const nozzles = pumpNozzles.filter(n => n.pumpId === nozzlePump.id);

          const handleSaveNozzle = () => {
            if (!nozzleForm.name.trim()) { toast.error('Le nom du pistolet est requis.'); return; }
            if (!nozzleForm.tankId) { toast.error('Choisissez la cuve de ce pistolet.'); return; }
            let next: PumpNozzle[];
            if (editingNozzle) {
              const updated = { ...editingNozzle, name: nozzleForm.name, tankId: nozzleForm.tankId, lastIndex: nozzleForm.lastIndex };
              dispatch({ type: 'UPDATE_NOZZLE', payload: updated });
              next = pumpNozzles.map(n => n.id === updated.id ? updated : n);
              toast.success('Pistolet mis à jour ✓');
            } else {
              const n: PumpNozzle = { id: newId(), pumpId: nozzlePump.id, name: nozzleForm.name, tankId: nozzleForm.tankId, lastIndex: nozzleForm.lastIndex, startIndex: nozzleForm.lastIndex, status: 'Actif', createdAt: new Date().toISOString() };
              dispatch({ type: 'ADD_NOZZLE', payload: n });
              next = [...pumpNozzles, n];
              toast.success('Pistolet ajouté ✓');
            }
            // The pump itself follows its pistolets so every per-cuve report
            // (brigades, fiche journalière, rapports) stays attributable.
            syncPumpFromNozzles(nozzlePump.id, next);
            setNozzleForm({ name: '', lastIndex: 0, tankId: nozzleForm.tankId });
            setEditingNozzle(null);
          };

          return (
            <div className="modal-shell z-[60]">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowNozzleModal(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white w-full max-w-xl rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[var(--modal-max-h)] border border-slate-100"
              >
                <div className="p-6 bg-gradient-to-r from-purple-900 via-purple-800 to-purple-900 text-white flex justify-between items-center shrink-0">
                  <div>
                    <h3 className="font-black text-xs uppercase tracking-widest italic flex items-center gap-2">
                      <Zap className="w-4 h-4 text-yellow-400" />
                      Pistolets — {nozzlePump.name}
                    </h3>
                    <p className="text-[10px] text-purple-200 font-bold mt-1">{nozzles.length} pistolet{nozzles.length !== 1 ? 's' : ''} • une cuve par pistolet</p>
                  </div>
                  <button onClick={() => setShowNozzleModal(false)} className="hover:bg-white/20 p-2 rounded-lg transition-all"><X className="w-6 h-6" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
                  {nozzles.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Pistolets configurés</p>
                      {nozzles.map(n => (
                        <div key={n.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                          <div className={cn("w-2 h-8 rounded-full flex-shrink-0", n.status === 'Actif' ? 'bg-green-400' : 'bg-slate-300')} />
                          <div className="flex-1 min-w-0">
                            <p className="font-black text-sm text-slate-800 truncate">{n.name}</p>
                            <p className="text-[10px] text-slate-400 font-bold">
                              Cuve: {tankLabel(nozzleTankId(n, pumps))} • Index: {n.lastIndex.toLocaleString()} L
                            </p>
                          </div>
                          <button
                            onClick={() => dispatch({ type: 'UPDATE_NOZZLE', payload: { ...n, status: n.status === 'Actif' ? 'Inactif' : 'Actif' } })}
                            className={cn("p-1.5 rounded-lg transition-colors", n.status === 'Actif' ? 'hover:bg-green-50 text-green-600' : 'hover:bg-slate-200 text-slate-400')}
                            title={n.status === 'Actif' ? 'Désactiver' : 'Activer'}
                          >
                            {n.status === 'Actif' ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                          </button>
                          <button
                            onClick={() => { setEditingNozzle(n); setNozzleForm({ name: n.name, lastIndex: n.lastIndex, tankId: nozzleTankId(n, pumps) || '' }); }}
                            className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-500 transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { dispatch({ type: 'DELETE_NOZZLE', payload: n.id }); toast.success('Pistolet supprimé'); }}
                            className="p-1.5 hover:bg-red-50 rounded-lg text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="p-5 bg-purple-50 rounded-2xl border border-purple-100 space-y-4">
                    <p className="text-[9px] font-black text-purple-700 uppercase tracking-widest">
                      {editingNozzle ? `Modifier: ${editingNozzle.name}` : 'Ajouter un pistolet'}
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Nom / Référence</label>
                        <input
                          type="text"
                          className="w-full px-3 py-2 bg-white border border-purple-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-purple-500"
                          placeholder="Ex: P1-A, Pistolet 1..."
                          value={nozzleForm.name}
                          onChange={e => setNozzleForm(f => ({ ...f, name: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Index (L)</label>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          className="w-full px-3 py-2 bg-white border border-purple-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-purple-500"
                          value={nozzleForm.lastIndex}
                          onChange={e => setNozzleForm(f => ({ ...f, lastIndex: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                      {/* The cuve is chosen here, per pistolet — not on the pump. */}
                      <div className="col-span-2">
                        <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">🪣 Cuve liée à ce pistolet</label>
                        <select
                          className="w-full px-3 py-2 bg-white border border-purple-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-purple-500"
                          value={nozzleForm.tankId}
                          onChange={e => setNozzleForm(f => ({ ...f, tankId: e.target.value }))}
                        >
                          <option value="">Choisir une cuve</option>
                          {tanks.map(t => <option key={t.id} value={t.id}>{t.name} ({t.type})</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      {editingNozzle && (
                        <button onClick={() => { setEditingNozzle(null); setNozzleForm({ name: '', lastIndex: 0, tankId: nozzlePump.tankId || tanks[0]?.id || '' }); }} className="flex-1 py-2.5 text-[10px] font-black uppercase text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50">
                          Annuler
                        </button>
                      )}
                      <button
                        onClick={handleSaveNozzle}
                        className="flex-[2] py-2.5 bg-gradient-to-r from-purple-700 to-purple-800 text-white font-black uppercase tracking-widest rounded-xl text-[10px] flex items-center justify-center gap-2"
                      >
                        <Save className="w-4 h-4" />
                        {editingNozzle ? 'Enregistrer' : 'Ajouter'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-slate-50 border-t border-slate-200 shrink-0">
                  <button onClick={() => setShowNozzleModal(false)} className="w-full py-3 text-[10px] font-black uppercase text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-100">
                    Fermer
                  </button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E5E7EB;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
      `}</style>
    </div>
  );
};

export default Pumps;
