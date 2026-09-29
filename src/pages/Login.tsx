import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Fuel, Globe, User, Lock, ArrowRight, ShieldCheck, Zap,
  BarChart3, Clock, Eye, EyeOff, UserPlus, Mail, AtSign, X,
  CheckCircle2, AlertCircle, Crown, Briefcase, Users, Store, UtensilsCrossed,
  Coffee, Droplets,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  signIn, signUpAdmin, signOut, adminExists, probeBackend, BACKEND_STATUS_MESSAGE,
  DEMO_ACCOUNTS, DemoAccount,
} from "../lib/supabase";
import { useAppState } from "../store/AppContext";

type UserRole = 'admin' | 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin' | 'module_worker';
type View = 'login' | 'signup';

interface LoginProps {
  onLogin: (role: UserRole, userId?: string) => void;
}

// ─── Sub-component: Feature badges ────────────────────────────────────────────
const features = [
  { icon: Zap,       titleKey: "login.feature_realtime_title",  descKey: "login.feature_realtime_desc" },
  { icon: BarChart3, titleKey: "login.feature_analytics_title", descKey: "login.feature_analytics_desc" },
  { icon: Clock,     titleKey: "login.feature_teams_title",     descKey: "login.feature_teams_desc" },
];

// ─── Demo quick access ────────────────────────────────────────────────────────
const QUICK_ACCESS_META: Record<string, { icon: React.ElementType; color: string }> = {
  admin:        { icon: Crown,           color: "#003087" },
  gerant:       { icon: Briefcase,       color: "#4c1d95" },
  chef_brigade: { icon: Users,           color: "#0f766e" },
  pompiste:     { icon: Fuel,            color: "#b45309" },
  magasin:      { icon: Store,           color: "#475569" },
  restaurant:   { icon: UtensilsCrossed, color: "#be123c" },
  cafeteria:    { icon: Coffee,          color: "#92400e" },
  lavage:       { icon: Droplets,        color: "#0e7490" },
};

// ─── Main Component ───────────────────────────────────────────────────────────
const Login = ({ onLogin }: LoginProps) => {
  const { t, i18n } = useTranslation();
  const { settings } = useAppState();
  const stationName    = settings?.name    || 'Station Naftal';
  const stationLogo    = settings?.logoUrl || settings?.logo || null;
  const stationAddress = settings?.address || '';
  const [view, setView]           = useState<View>('login');

  // Login form state
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [showPass, setShowPass]   = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);

  // Signup form state
  const [signupName, setSignupName]         = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail]       = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm]   = useState("");
  const [showSignupPass, setShowSignupPass] = useState(false);
  const [signupError, setSignupError]       = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess]   = useState(false);
  const [signupLoading, setSignupLoading]   = useState(false);

  // Whether the "Create admin account" button should be shown. It is visible only
  // until the first administrator has been created (then it hides automatically).
  const [canCreateAdmin, setCanCreateAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const exists = await adminExists();
      if (alive) setCanCreateAdmin(!exists);
    })();
    return () => { alive = false; };
  }, []);

  const toggleLanguage = () => {
    const newLang = i18n.language === "fr" ? "ar" : "fr";
    i18n.changeLanguage(newLang);
    document.documentElement.dir = i18n.dir();
  };

  // ── Login (demo accounts, no database) ────────────────────────────────────
  const handleLogin = async (e?: React.FormEvent, creds?: { email: string; password: string }) => {
    e?.preventDefault();
    setLoginError(null);
    const id = (creds?.email ?? email).trim();
    const pass = (creds?.password ?? password).trim();

    if (!id || !pass) {
      setLoginError(t('login.error_missing'));
      return;
    }

    setLoading(true);
    const result = await signIn(id, pass);
    setLoading(false);

    if ('error' in result && result.error) {
      // Only a genuine credential rejection should say "identifiants invalides":
      // reporting a blocked or rate-limited connection that way sends people
      // hunting for a password problem that does not exist.
      if (result.reason === 'rate_limited') {
        setLoginError("Trop de tentatives de connexion depuis ce réseau. Patientez une minute puis réessayez.");
        return;
      }
      if (result.reason === 'network') {
        // « Vérifiez votre connexion Internet » est faux neuf fois sur dix : le
        // poste est en ligne et c'est la BASE qui ne répond pas. On demande à
        // qui appartient la panne avant de l'annoncer.
        setLoading(true);
        const status = await probeBackend();
        setLoading(false);
        setLoginError(BACKEND_STATUS_MESSAGE[status === 'ok' ? 'database' : status]);
        return;
      }
      setLoginError(t('login.error_invalid'));
      return;
    }

    const role = (result as any).role as UserRole | null;
    if (!role) {
      // Auth succeeded but no matching worker/admin record — refuse access
      await signOut();
      setLoading(false);
      setLoginError("Accès refusé. Aucun rôle associé à ce compte.");
      return;
    }
    onLogin(role, result.user?.id);
  };

  /** One click on a demo profile: fill the form and sign in straight away. */
  const quickLogin = (acc: DemoAccount) => {
    setEmail(acc.email);
    setPassword(acc.password);
    handleLogin(undefined, { email: acc.email, password: acc.password });
  };

  // ── Create admin account via Supabase auth ────────────────────────────────
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError(null);

    if (!signupName.trim())     { setSignupError("Le nom est requis.");            return; }
    if (!signupUsername.trim()) { setSignupError("Le nom d'utilisateur est requis."); return; }
    if (!signupEmail.trim())    { setSignupError("L'email est requis.");            return; }
    if (signupPassword.length < 6) { setSignupError("Le mot de passe doit avoir au moins 6 caractères."); return; }
    if (signupPassword !== signupConfirm) { setSignupError("Les mots de passe ne correspondent pas."); return; }

    setSignupLoading(true);
    const result = await signUpAdmin({
      name:     signupName.trim(),
      username: signupUsername.trim(),
      email:    signupEmail.trim(),
      password: signupPassword,
    });
    setSignupLoading(false);

    if ('error' in result && result.error) {
      setSignupError(result.error);
      return;
    }

    // Admin now exists → the "Create admin account" button hides for good.
    setCanCreateAdmin(false);
    setSignupSuccess(true);
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const resetSignup = () => {
    setSignupName(""); setSignupUsername(""); setSignupEmail("");
    setSignupPassword(""); setSignupConfirm(""); setSignupError(null);
    setSignupSuccess(false);
  };

  const switchToLogin = () => { resetSignup(); setView('login'); };
  const switchToSignup = () => { setLoginError(null); setView('signup'); };

  return (
    <div className="min-h-screen flex" style={{ background: "#eef3fc" }}>

      {/* ── Left decorative panel ── */}
      <motion.div
        initial={{ x: -40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="hidden lg:flex flex-col w-[52%] relative overflow-hidden"
        style={{ background: "linear-gradient(155deg, #001233 0%, #001f5c 30%, #003087 65%, #002470 100%)" }}
      >
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(255,184,0,0.14), transparent 65%)", transform: "translate(35%,-35%)" }} />
        <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(0,68,187,0.25), transparent 65%)", transform: "translate(-40%,40%)" }} />
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: "#FFB800" }} />

        <div className="relative z-10 p-14 flex flex-col h-full">
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl overflow-hidden"
              style={{ background: "linear-gradient(135deg, #FFB800, #e6a000)", boxShadow: "0 8px 24px rgba(255,184,0,0.45)" }}>
              {stationLogo
                ? <img src={stationLogo} alt="logo" className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                : <Fuel className="w-7 h-7 text-[#001f5c]" />
              }
            </div>
            <div>
              <h1 className="text-3xl font-black text-white tracking-tight">{stationName}</h1>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(255,184,0,0.65)" }}>
                Système de gestion
              </p>
              {stationAddress && (
                <p className="text-[10px] text-white/40 font-medium mt-0.5 truncate max-w-[200px]">{stationAddress}</p>
              )}
            </div>
          </motion.div>

          <div className="flex-1 flex flex-col justify-center">
            <motion.div initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
              <p className="text-xs font-black uppercase tracking-[0.22em] mb-5" style={{ color: "rgba(255,184,0,0.65)" }}>
                {t('login.left_kicker')}
              </p>
              <h2 className="text-5xl font-black text-white leading-[1.12] mb-6">
                {t('login.left_title_1')}<br />
                {t('login.left_title_2')}{" "}
                <span style={{ color: "#FFB800" }}>{t('login.left_title_3')}<br />{t('login.left_title_4')}</span>
              </h2>
              <p className="text-white/45 text-base max-w-sm leading-relaxed">
                {t('login.left_desc')}
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
              className="mt-12 space-y-3">
              {features.map((f, i) => (
                <motion.div key={i}
                  initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.1 }}
                  className="flex items-center gap-4 p-4 rounded-2xl transition-all hover:bg-white/5"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(255,184,0,0.15)" }}>
                    <f.icon className="w-5 h-5" style={{ color: "#FFB800" }} />
                  </div>
                  <div>
                    <p className="text-white font-bold text-sm">{t(f.titleKey)}</p>
                    <p className="text-white/40 text-xs">{t(f.descKey)}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>

          <div className="text-white/20 text-xs">© 2026 altech station</div>
        </div>
      </motion.div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 relative overflow-y-auto">

        {/* Language toggle */}
        <button onClick={toggleLanguage}
          className="absolute top-6 right-6 flex items-center gap-2 px-3 py-2 bg-white hover:bg-slate-50 rounded-xl text-sm font-bold text-slate-600 transition-all border border-slate-200 shadow-sm">
          <Globe className="w-4 h-4" />
          {i18n.language === "fr" ? "العربية" : "Français"}
        </button>

        <AnimatePresence mode="wait">

          {/* ═══ LOGIN FORM ══════════════════════════════════════════════════ */}
          {view === 'login' && (
            <motion.div key="login"
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.35 }}
              className="w-full max-w-md">

              {/* Mobile logo */}
              <div className="lg:hidden flex items-center gap-3 mb-10">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden"
                  style={{ background: "linear-gradient(135deg,#FFB800,#e6a000)", boxShadow: "0 4px 14px rgba(255,184,0,0.4)" }}>
                  {stationLogo
                    ? <img src={stationLogo} alt="logo" className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    : <Fuel className="w-6 h-6 text-[#001f5c]" />
                  }
                </div>
                <div>
                  <h1 className="text-2xl font-black" style={{ color: "#003087" }}>{stationName}</h1>
                  <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "rgba(255,184,0,0.8)" }}>
                    Système de gestion
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-3xl p-8"
                style={{ boxShadow: "0 24px 64px rgba(0,48,135,0.13), 0 4px 16px rgba(0,48,135,0.07)" }}>

                {/* Header */}
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,48,135,0.07)" }}>
                      <ShieldCheck className="w-4 h-4" style={{ color: "#003087" }} />
                    </div>
                    <span className="text-xs font-black uppercase tracking-widest" style={{ color: "rgba(0,48,135,0.4)" }}>
                      {t('login.secure_access')}
                    </span>
                  </div>
                  <h2 className="text-2xl font-black" style={{ color: "#003087" }}>{t('login.title')}</h2>
                  <p className="text-slate-400 text-sm mt-1">{t('login.subtitle')}</p>
                </div>

                {/* Error banner */}
                {loginError && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 mb-5 p-3 bg-red-50 border border-red-200 rounded-xl">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-sm text-red-600 font-medium">{loginError}</p>
                  </motion.div>
                )}

                {/* Form */}
                <form className="space-y-5" onSubmit={handleLogin}>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">{t('login.email')}</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400/40 focus:border-yellow-400 transition-all"
                        placeholder="email@exemple.dz" autoComplete="email" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">{t('login.password')}</label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                      <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                        className="w-full pl-10 pr-10 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400/40 focus:border-yellow-400 transition-all"
                        placeholder="••••••••" autoComplete="current-password" />
                      <button type="button" onClick={() => setShowPass(v => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors">
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button type="submit" disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-black text-sm uppercase tracking-widest text-[#001f5c] transition-all duration-200 hover:shadow-xl active:scale-[0.98] disabled:opacity-70"
                    style={{ background: "linear-gradient(135deg, #FFB800 0%, #e6a000 100%)", boxShadow: "0 4px 16px rgba(255,184,0,0.4)" }}>
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-[#001f5c]/30 border-t-[#001f5c] rounded-full animate-spin" />
                    ) : (
                      <><span>{t('login.submit')}</span><ArrowRight className="w-4 h-4" /></>
                    )}
                  </button>
                </form>

                {/* ── Demo: one-click access to every profile ── */}
                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Accès rapide — version démo
                  </span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {DEMO_ACCOUNTS.map(acc => {
                    const meta = QUICK_ACCESS_META[acc.moduleKey || acc.role] || QUICK_ACCESS_META.admin;
                    const Icon = meta.icon;
                    return (
                      <button
                        key={acc.userId}
                        type="button"
                        disabled={loading}
                        onClick={() => quickLogin(acc)}
                        title={`${acc.name} — ${acc.email} / ${acc.password}`}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-left hover:shadow-md hover:border-slate-300 active:scale-[0.98] transition-all disabled:opacity-60"
                      >
                        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: `${meta.color}14`, color: meta.color }}>
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-black text-slate-700 truncate">{acc.label}</span>
                          <span className="block text-[10px] text-slate-400 truncate">{acc.name}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-center text-[10px] text-slate-400 mt-3">
                  Données de démonstration — aucune base de données. Mot de passe de tous les comptes : <strong>demo123</strong>
                </p>

                {/* ── Create administrator account (shown only until one exists) ── */}
                {canCreateAdmin && (
                  <>
                    <div className="flex items-center gap-3 my-5">
                      <div className="flex-1 h-px bg-slate-100" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">
                        Première configuration
                      </span>
                      <div className="flex-1 h-px bg-slate-100" />
                    </div>

                    <button
                      type="button"
                      onClick={switchToSignup}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-black text-sm uppercase tracking-widest transition-all duration-200 hover:shadow-lg active:scale-[0.98] border-2"
                      style={{ borderColor: "#003087", color: "#003087", background: "white" }}
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>Créer un compte administrateur</span>
                    </button>

                    <p className="text-center text-[11px] text-slate-400 mt-3 font-medium">
                      Aucun administrateur n'existe encore. Créez le compte principal.
                    </p>
                  </>
                )}

                <p className="text-center text-[10px] text-slate-300 mt-4">
                  {stationName} · {t('login.secure_footer')}
                </p>
              </div>
            </motion.div>
          )}

          {/* ═══ SIGNUP FORM ═════════════════════════════════════════════════ */}
          {view === 'signup' && (
            <motion.div key="signup"
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.35 }}
              className="w-full max-w-md">

              <div className="bg-white rounded-3xl p-8"
                style={{ boxShadow: "0 24px 64px rgba(0,48,135,0.13), 0 4px 16px rgba(0,48,135,0.07)" }}>

                {/* Header */}
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,48,135,0.07)" }}>
                        <UserPlus className="w-4 h-4" style={{ color: "#003087" }} />
                      </div>
                      <span className="text-xs font-black uppercase tracking-widest" style={{ color: "rgba(0,48,135,0.4)" }}>
                        Nouveau Compte
                      </span>
                    </div>
                    <h2 className="text-2xl font-black" style={{ color: "#003087" }}>Créer un Admin</h2>
                    <p className="text-slate-400 text-sm mt-1">Créez votre compte administrateur</p>
                  </div>
                  <button onClick={switchToLogin}
                    className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Success state */}
                {signupSuccess ? (
                  <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                    className="text-center py-8">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                      style={{ background: "rgba(16,185,129,0.1)" }}>
                      <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mb-2">Compte créé !</h3>
                    <p className="text-slate-500 text-sm mb-2">
                      Votre compte administrateur a été créé avec succès.
                    </p>
                    <p className="text-slate-400 text-xs mb-6">
                      Connectez-vous dès maintenant avec votre email et votre mot de passe.
                    </p>
                    <button onClick={switchToLogin}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm text-[#001f5c] transition-all"
                      style={{ background: "linear-gradient(135deg, #FFB800, #e6a000)", boxShadow: "0 4px 16px rgba(255,184,0,0.4)" }}>
                      <ArrowRight className="w-4 h-4" />
                      Aller à la Connexion
                    </button>
                  </motion.div>
                ) : (
                  <>
                    {/* Error banner */}
                    {signupError && (
                      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-3 mb-5 p-3 bg-red-50 border border-red-200 rounded-xl">
                        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        <p className="text-sm text-red-600 font-medium">{signupError}</p>
                      </motion.div>
                    )}

                    <form className="space-y-4" onSubmit={handleSignup}>

                      {/* Full name */}
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1.5">Nom Complet *</label>
                        <div className="relative">
                          <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                          <input type="text" value={signupName} onChange={e => setSignupName(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                            placeholder="Mohammed Benali" required />
                        </div>
                      </div>

                      {/* Username */}
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1.5">Nom d'utilisateur *</label>
                        <div className="relative">
                          <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                          <input type="text" value={signupUsername} onChange={e => setSignupUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                            placeholder="m.benali" required />
                        </div>
                      </div>

                      {/* Email */}
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1.5">Adresse Email *</label>
                        <div className="relative">
                          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                          <input type="email" value={signupEmail} onChange={e => setSignupEmail(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                            placeholder="admin@stationpro.dz" required />
                        </div>
                      </div>

                      {/* Password */}
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1.5">Mot de Passe * (min. 6 caractères)</label>
                        <div className="relative">
                          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                          <input type={showSignupPass ? "text" : "password"} value={signupPassword} onChange={e => setSignupPassword(e.target.value)}
                            className="w-full pl-10 pr-10 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                            placeholder="••••••••" minLength={6} required />
                          <button type="button" onClick={() => setShowSignupPass(v => !v)}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors">
                            {showSignupPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Confirm password */}
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1.5">Confirmer le Mot de Passe *</label>
                        <div className="relative">
                          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                          <input type={showSignupPass ? "text" : "password"} value={signupConfirm} onChange={e => setSignupConfirm(e.target.value)}
                            className={`w-full pl-10 pr-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${
                              signupConfirm && signupConfirm !== signupPassword
                                ? 'border-red-300 focus:ring-red-500/30 focus:border-red-400'
                                : 'border-slate-200 focus:ring-blue-500/30 focus:border-blue-400'
                            }`}
                            placeholder="••••••••" required />
                        </div>
                        {signupConfirm && signupConfirm !== signupPassword && (
                          <p className="text-xs text-red-500 mt-1">Les mots de passe ne correspondent pas</p>
                        )}
                      </div>

                      {/* Role badge (always admin) */}
                      <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: "rgba(0,48,135,0.06)" }}>
                        <ShieldCheck className="w-4 h-4" style={{ color: "#003087" }} />
                        <span className="text-xs font-bold" style={{ color: "#003087" }}>
                          Rôle : Administrateur · Accès complet au système
                        </span>
                      </div>

                      {/* Submit */}
                      <button type="submit" disabled={signupLoading}
                        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-black text-sm uppercase tracking-wider text-[#001f5c] transition-all disabled:opacity-70 mt-2"
                        style={{ background: "linear-gradient(135deg, #FFB800, #e6a000)", boxShadow: "0 4px 16px rgba(255,184,0,0.4)" }}>
                        {signupLoading ? (
                          <div className="w-5 h-5 border-2 border-[#001f5c]/30 border-t-[#001f5c] rounded-full animate-spin" />
                        ) : (
                          <><UserPlus className="w-4 h-4" /><span>Créer le Compte</span></>
                        )}
                      </button>
                    </form>

                    {/* Back to login */}
                    <button onClick={switchToLogin}
                      className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-all">
                      ← Retour à la Connexion
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
};

export default Login;
