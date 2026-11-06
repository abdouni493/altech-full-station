/**
 * Fenêtre « Nouveau client / Modifier profil client » — la MÊME que celle de
 * l'écran Clients, partagée avec l'écran Ventes Carburant.
 */
import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, User as UserIcon, ShieldCheck, Lock, ChevronDown, Loader2, Save } from "lucide-react";
import { cn, newId } from "@/src/lib/utils";
import { Client, useAppDispatch } from "../../store/AppContext";

export function blankClientForm(): Partial<Client> {
  return {
    name: "", type: "PARTICULIER", paymentMode: "CASH", phone: "", email: "", cin: "", address: "",
    contactPerson: "", creditLimit: 0, paymentDelay: 0, balance: 0, debt: 0,
    openingDebt: 0, openingAdvance: 0, openingDate: new Date().toISOString().split("T")[0], openingNotes: "",
    nif: "", nis: "", article: "", rc: "",
  };
}

export function ClientFormModal({
  selectedClient, clientForm, setClientForm, onSave, onClose, isLoading,
}: {
  selectedClient: Client | null;
  clientForm: Partial<Client>;
  setClientForm: (f: Partial<Client>) => void;
  onSave: () => void;
  onClose: () => void;
  isLoading?: boolean;
}) {
  const [showFiscalSection, setShowFiscalSection] = useState(false);
  return (
          <div className="modal-shell z-[70] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => onClose()} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-4xl rounded-[3rem] relative z-10 flex flex-col max-h-[var(--modal-max-h)] overflow-hidden shadow-2xl border border-blue-200"
            >
              {/* Premium Gradient Header */}
              <div className="p-8 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white flex items-center justify-between shrink-0 border-b border-blue-900/10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center border border-white/5 shadow-xl">
                    <UserIcon className="w-6 h-6 text-yellow-400" />
                  </div>
                  <div>
                    <h3 className="font-black text-lg uppercase tracking-tighter italic text-yellow-400">
                      {selectedClient ? "Modifier Profil Client" : "Nouveau Client"}
                    </h3>
                    <p className="text-[11px] text-blue-200 font-bold mt-1">Saisie des données administratives et financières</p>
                  </div>
                </div>
                <button onClick={() => onClose()} className="p-3 hover:bg-white/10 rounded-2xl transition-all"><X className="w-6 h-6 text-white" /></button>
              </div>

              {/* Scrollable Form Body */}
              <div className="flex-1 overflow-y-auto p-10 space-y-8 custom-scrollbar">
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left Column: Client Identity Card */}
                  <div className="p-8 bg-gradient-to-br from-blue-50 to-slate-50 rounded-[2.5rem] border-2 border-slate-100 space-y-6">
                    <h4 className="text-[10px] font-black text-blue-900 uppercase tracking-widest border-b pb-2">Identité Administrative</h4>
                    
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">NOM OU RAISON SOCIALE</label>
                      <input 
                        type="text" 
                        value={clientForm.name} 
                        onChange={e => setClientForm({...clientForm, name: e.target.value})} 
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14" 
                        placeholder="Ex: SONATRACH / CLIENT PARTICULIER" 
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">TYPE DE CLIENT</label>
                        <select 
                          value={clientForm.type} 
                          onChange={e => setClientForm({...clientForm, type: e.target.value as any})} 
                          className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14"
                        >
                          <option value="PARTICULIER">Particulier</option>
                          <option value="ENTREPRISE">Entreprise</option>
                          <option value="GOUVERNEMENT">Gouvernement</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">TÉLÉPHONE</label>
                        <input 
                          type="text" 
                          value={clientForm.phone} 
                          onChange={e => setClientForm({...clientForm, phone: e.target.value})} 
                          className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14" 
                          placeholder="Ex: 0550 12 34 56" 
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">ADRESSE EMAIL</label>
                      <input 
                        type="email" 
                        value={clientForm.email} 
                        onChange={e => setClientForm({...clientForm, email: e.target.value})} 
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black lowercase text-xs tracking-widest shadow-inner h-14" 
                        placeholder="client@domaine.dz" 
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">CIN / IDENTIFIANT REGISTRE</label>
                      <input 
                        type="text" 
                        value={clientForm.cin} 
                        onChange={e => setClientForm({...clientForm, cin: e.target.value})} 
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14" 
                        placeholder="Numéro CIN ou ICE..." 
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">ADRESSE DU DOMICILE / SIÈGE</label>
                      <input 
                        type="text" 
                        value={clientForm.address} 
                        onChange={e => setClientForm({...clientForm, address: e.target.value})} 
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14" 
                        placeholder="Adresse postale..." 
                      />
                    </div>
                  </div>

                  {/* Right Column: Conditions and Financial details */}
                  <div className="p-8 bg-gradient-to-br from-blue-50 to-slate-50 rounded-[2.5rem] border-2 border-slate-100 space-y-6 flex flex-col">
                    <h4 className="text-[10px] font-black text-blue-900 uppercase tracking-widest border-b pb-2">Conditions Financières</h4>
                    
                    <div className="space-y-3">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">MODE DE PAIEMENT PAR DÉFAUT</label>
                      <div className="grid grid-cols-3 gap-2">
                        {["CASH", "ADVANCE", "CREDIT"].map(m => (
                          <button 
                            key={m}
                            type="button"
                            onClick={() => setClientForm({...clientForm, paymentMode: m as any})}
                            className={cn(
                              "p-4 rounded-2xl border-2 text-[9px] font-black uppercase tracking-widest transition-all italic",
                              clientForm.paymentMode === m ? "border-blue-900 bg-blue-100/50 text-blue-900" : "border-slate-100 bg-white text-slate-400 hover:bg-slate-50"
                            )}
                          >
                            {m === "CASH" ? "Comptant" : m === "ADVANCE" ? "Avance" : "Crédit"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Mode specific parameters */}
                    <div className="flex-1 flex flex-col justify-center">
                      <AnimatePresence mode="wait">
                        {clientForm.paymentMode === "CREDIT" ? (
                          <motion.div 
                            key="credit" 
                            initial={{ opacity: 0, scale: 0.98 }} 
                            animate={{ opacity: 1, scale: 1 }} 
                            exit={{ opacity: 0, scale: 0.98 }}
                            className="p-6 bg-red-50/50 rounded-2xl border border-red-100 space-y-4 w-full"
                          >
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-red-600 uppercase tracking-widest ml-1">Plafond Crédit Autorisé (DA)</label>
                              <input type="number" className="input-field bg-white border-red-100 text-red-950 font-black h-13 shadow-inner" value={clientForm.creditLimit} onChange={e => setClientForm({...clientForm, creditLimit: parseFloat(e.target.value) || 0})} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-red-600 uppercase tracking-widest ml-1">Délai Contractuel de Règlement (Jours)</label>
                              <input type="number" className="input-field bg-white border-red-100 text-red-950 font-black h-13 shadow-inner" value={clientForm.paymentDelay} onChange={e => setClientForm({...clientForm, paymentDelay: parseInt(e.target.value) || 0})} />
                            </div>
                            {/* ── La dette de reprise ──────────────────────
                                Elle ne s'affichait qu'à la CRÉATION, et n'était
                                écrite que dans le compteur `debt` de la fiche :
                                l'historique du client s'ouvrait donc vide, sa
                                carte annonçait 0, et le rapport général ne
                                comptait pas la créance. Elle est maintenant une
                                LIGNE de son compte — et se corrige à tout moment. */}
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-red-600 uppercase tracking-widest ml-1">Dette initiale à l'ouverture (DA)</label>
                              <input type="number" className="input-field bg-white border-red-100 text-red-950 font-black h-13 shadow-inner" value={clientForm.openingDebt ?? 0} onChange={e => setClientForm({...clientForm, openingDebt: parseFloat(e.target.value) || 0})} />
                              <p className="text-[9px] font-bold text-red-700/60 leading-relaxed ml-1">
                                Ce que le client devait DÉJÀ avant sa fiche. Elle entre dans son historique,
                                sur sa carte, dans la Caisse Générale et dans les rapports — sans faire
                                entrer d'argent en caisse : la somme a été engagée avant ce compte.
                              </p>
                            </div>
                          </motion.div>
                        ) : clientForm.paymentMode === "ADVANCE" ? (
                          <motion.div 
                            key="advance" 
                            initial={{ opacity: 0, scale: 0.98 }} 
                            animate={{ opacity: 1, scale: 1 }} 
                            exit={{ opacity: 0, scale: 0.98 }}
                            className="p-6 bg-green-50/50 rounded-2xl border border-green-100 space-y-4 w-full"
                          >
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-green-700 uppercase tracking-widest ml-1">Avance initiale à l'ouverture (DA)</label>
                              <input type="number" className="input-field bg-white border-green-100 text-green-950 font-black h-13 shadow-inner" value={clientForm.openingAdvance ?? 0} onChange={e => setClientForm({...clientForm, openingAdvance: parseFloat(e.target.value) || 0})} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Dette initiale à l'ouverture (DA)</label>
                              <input type="number" className="input-field bg-white border-slate-200 text-red-950 font-black h-13 shadow-inner" value={clientForm.openingDebt ?? 0} onChange={e => setClientForm({...clientForm, openingDebt: parseFloat(e.target.value) || 0})} />
                            </div>
                            <p className="text-[9px] font-bold text-green-700/70 italic leading-relaxed">
                              Les ventes et consommations boutique et carburant seront automatiquement imputées sur ce compte d'avance.
                              L'avance initiale ouvre l'historique du client, se déduit de ce qu'il doit et se retrouve
                              dans la Caisse Générale et dans les rapports.
                            </p>
                          </motion.div>
                        ) : (
                          <motion.div 
                            key="cash"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 0.4 }}
                            className="p-8 bg-slate-100 rounded-2xl flex flex-col items-center justify-center text-center italic space-y-3 w-full"
                          >
                            <ShieldCheck className="w-12 h-12 text-slate-500" />
                            <p className="text-[9px] font-black uppercase tracking-widest">Paiement comptant standard sans encours ni avance.</p>
                            <p className="text-[9px] font-bold normal-case text-slate-500 leading-relaxed">
                              Une reprise reste possible : ouvrez « Dette initiale » depuis le menu
                              de sa carte si ce client traînait déjà une ardoise.
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* La date de la reprise — elle place la ligne d'ouverture en
                    TÊTE du journal ; sans elle, le solde après chaque opération
                    se calculerait à partir du mauvais point de départ. */}
                {((clientForm.openingDebt || 0) > 0 || (clientForm.openingAdvance || 0) > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-[2rem] bg-amber-50/60 border border-amber-100">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-amber-700 uppercase tracking-widest ml-1">Date de la reprise</label>
                      <input type="date" className="input-field bg-white border-amber-200 focus:border-amber-500 text-blue-900 font-black text-xs h-13 shadow-inner"
                        value={(clientForm.openingDate || '').split('T')[0]}
                        onChange={e => setClientForm({ ...clientForm, openingDate: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-amber-700 uppercase tracking-widest ml-1">Note de reprise (facultatif)</label>
                      <input type="text" placeholder="Ancien carnet, solde repris au 01/01…"
                        className="input-field bg-white border-amber-200 focus:border-amber-500 text-blue-900 font-black text-xs h-13 shadow-inner"
                        value={clientForm.openingNotes || ''}
                        onChange={e => setClientForm({ ...clientForm, openingNotes: e.target.value })} />
                    </div>
                  </div>
                )}

                {/* Collapsible Fiscal Panel */}
                <div className="border-t border-slate-100 pt-6">
                  <button 
                    type="button"
                    onClick={() => setShowFiscalSection(!showFiscalSection)}
                    className="flex items-center justify-between w-full p-4 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-colors text-[10px] font-black text-slate-500 uppercase tracking-widest italic"
                  >
                    <span className="flex items-center gap-3"><Lock className="w-4 h-4 text-blue-950" /> Informations Fiscales & Commerciales (Optionnel)</span>
                    <ChevronDown className={cn("w-5 h-5 text-slate-400 transition-transform", showFiscalSection && "rotate-180")} />
                  </button>

                  <AnimatePresence>
                    {showFiscalSection && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden mt-4"
                      >
                        <div className="p-8 bg-gradient-to-br from-slate-50 to-blue-50/50 rounded-[2rem] border border-blue-100/50 space-y-4 grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">NIF</label>
                            <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-13" value={clientForm.nif || ""} onChange={e => setClientForm({...clientForm, nif: e.target.value})} placeholder="Numéro d'Identification Fiscale" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">NIS</label>
                            <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-13" value={clientForm.nis || ""} onChange={e => setClientForm({...clientForm, nis: e.target.value})} placeholder="Numéro d'Identification Statistique" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">ARTICLE IMPOSITION</label>
                            <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-13" value={clientForm.article || ""} onChange={e => setClientForm({...clientForm, article: e.target.value})} placeholder="Code Article d'imposition" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">REGISTRE DE COMMERCE (RC)</label>
                            <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-13" value={clientForm.rc || ""} onChange={e => setClientForm({...clientForm, rc: e.target.value})} placeholder="Numéro Registre de Commerce" />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-8 bg-slate-50 border-t flex gap-6 shrink-0">
                <button onClick={() => onClose()} className="px-10 py-5 text-[11px] font-black uppercase text-slate-400 hover:text-slate-600 transition-all italic underline underline-offset-8">Annuler</button>
                <button 
                  onClick={onSave} 
                  disabled={isLoading}
                  className="flex-1 h-16 bg-gradient-to-r from-blue-900 to-blue-800 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-2xl flex items-center justify-center gap-4 italic transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-yellow-400" /> : <Save className="w-5 h-5 text-yellow-400" />}
                  {isLoading ? "ENREGISTREMENT..." : "Enregistrer Profil"}
                </button>
              </div>
            </motion.div>
          </div>
  );
}

/**
 * Création autonome d'un client (même formulaire, même règles que l'écran
 * Clients) : utilisée par les écrans qui doivent créer un client « sur place ».
 */
export function NewClientModal({ onClose, onCreated, initialName }: {
  onClose: () => void;
  onCreated: (c: Client) => void;
  initialName?: string;
}) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState<Partial<Client>>(() => ({ ...blankClientForm(), name: initialName || "" }));
  const [loading, setLoading] = useState(false);
  const save = () => {
    if (!form.name) { dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Le nom est obligatoire" } }); return; }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Email invalide" } }); return;
    }
    setLoading(true);
    const openDebt = Math.max(0, form.openingDebt || 0);
    const openAdv = Math.max(0, form.openingAdvance || 0);
    const c: Client = {
      ...form as Client, id: newId(), balance: openAdv, advanceBalance: openAdv, debt: openDebt,
      openingDebt: openDebt, openingAdvance: openAdv,
      openingDate: form.openingDate || new Date().toISOString().split("T")[0], transactionHistory: [],
    };
    dispatch({ type: 'ADD_CLIENT', payload: c });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Client ajouté" } });
    setLoading(false);
    onCreated(c);
  };
  return (
    <AnimatePresence>
      <ClientFormModal selectedClient={null} clientForm={form} setClientForm={setForm} onSave={save} onClose={onClose} isLoading={loading} />
    </AnimatePresence>
  );
}
