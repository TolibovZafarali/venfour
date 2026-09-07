import { Activity, ChevronRight, ClipboardList, CreditCard, Files, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, TriangleAlert, Users, Workflow, X } from "lucide-react";
import { Dialog, Tooltip } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";

import { useDocumentMetadata } from "@/app/document-metadata";
import { SignInDialogProvider, useAuth } from "@/features/auth";
import { getFriendlyAuthError } from "@/features/auth/auth-errors";
import { getUserAccountLabel, getUserIdentityLabel } from "@/features/auth/user-display";
import { useAdminOverview } from "@/features/admin/operations/queries";
import venfourMark from "../../../../assets/brand/venfour-mark.svg";
import "./admin-workspace.css";

const storageKey = "venfour.admin.sidebar.collapsed";
const navigation = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Cases", href: "/admin/cases", icon: ClipboardList },
  { label: "Needs attention", href: "/admin/cases?view=attention", icon: TriangleAlert },
  { label: "Customers", href: "/admin/customers", icon: Users },
  { label: "Reports", href: "/admin/reports", icon: Files },
  { label: "Processing", href: "/admin/processing", icon: Workflow },
  { label: "Payments", href: "/admin/payments", icon: CreditCard },
  { label: "Activity", href: "/admin/activity", icon: Activity },
];

export function AdminEntry() {
  return <SignInDialogProvider><Outlet /></SignInDialogProvider>;
}

export function AdminLayout() {
  const { auth, signOut } = useAuth();
  const location = useLocation();
  const overview = useAdminOverview();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(storageKey) === "true"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const previousPathRef = useRef(location.pathname);
  const params = new URLSearchParams(location.search);
  const returnParams = new URLSearchParams((params.get("returnTo") ?? "").split("?")[1]);
  const attention = params.get("view") === "attention" || params.get("attention") === "true" ||
    (location.pathname.startsWith("/admin/cases/") && (returnParams.get("view") === "attention" || returnParams.get("attention") === "true"));
  const active = navigation.find((item) => item.label === "Needs attention" ? location.pathname.startsWith("/admin/cases") && attention
    : item.label === "Cases" ? location.pathname.startsWith("/admin/cases") && !attention
    : item.href === "/admin" ? location.pathname === "/admin" || location.pathname === "/admin/"
    : location.pathname.startsWith(item.href));
  const title = active?.label ?? "Workspace";
  const detail = /^\/admin\/(cases|customers)\/[^/]+/.test(location.pathname);
  useDocumentMetadata({ title: `${detail ? "Record details" : title} | Venfour Admin`, description: "Private Venfour staff operations workspace." });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setMobileOpen(false);
      if (previousPathRef.current !== location.pathname) {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        previousPathRef.current = location.pathname;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (media.matches) setMobileOpen(false); };
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, []);

  const toggle = () => setCollapsed((value) => {
    const next = !value;
    try { localStorage.setItem(storageKey, String(next)); } catch { /* Storage is optional for layout preferences. */ }
    return next;
  });
  const handleSignOut = async () => {
    setSignOutPending(true);
    setSignOutError(null);
    try { await signOut(); } catch (error) { setSignOutError(getFriendlyAuthError(error, "signout")); }
    finally { setSignOutPending(false); }
  };
  const user = auth.status === "signedIn" ? auth.user : null;

  const sidebarContent = (compact: boolean, mobile: boolean) => <>
    <div className="admin-sidebar-brand">
      <Link to="/admin" aria-label="Venfour admin overview" onClick={() => setMobileOpen(false)}>
        <img src={venfourMark} alt="" aria-hidden="true" />
        <span className="admin-nav-label">Venfour<span className="admin-brand-caption">OPERATIONS</span></span>
      </Link>
      {mobile && <Dialog.Close className="admin-icon-button" aria-label="Close navigation"><X size={20} /></Dialog.Close>}
    </div>
    <div className="admin-sidebar-section-label"><span className="admin-nav-label">WORKSPACE</span></div>
    <nav aria-label="Admin navigation" className="admin-navigation">
      {navigation.map((item, index) => <Tooltip.Root key={item.href} open={compact ? undefined : false}>
        <Tooltip.Trigger asChild>
          <Link to={item.href} aria-label={item.label} aria-current={active === item ? "page" : undefined}
            className={`admin-nav-link${index === 4 ? " admin-nav-group-start" : ""}`} onClick={() => setMobileOpen(false)}>
            <item.icon size={19} strokeWidth={1.7} aria-hidden="true" />
            <span className="admin-nav-label">{item.label}</span>
            {item.label === "Needs attention" && overview.data && overview.data.attentionCases > 0 && <span className="admin-nav-count" aria-label={`${overview.data.attentionCases} cases need attention`}>{overview.data.attentionCases}</span>}
          </Link>
        </Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Content side="right" sideOffset={12} className="admin-tooltip">{item.label}<Tooltip.Arrow /></Tooltip.Content></Tooltip.Portal>
      </Tooltip.Root>)}
    </nav>
    <div className="admin-sidebar-footer">
      <div className="admin-staff-identity"><span className="admin-avatar" aria-hidden="true">{user ? getUserAccountLabel(user).slice(0, 1).toUpperCase() : "V"}</span><span className="admin-nav-label"><strong>{user ? getUserAccountLabel(user) : "Staff"}</strong><span>{user ? getUserIdentityLabel(user) : ""}</span></span></div>
      <Tooltip.Root open={compact ? undefined : false}><Tooltip.Trigger asChild><button className="admin-nav-link" type="button" aria-label="Sign out" disabled={signOutPending} onClick={() => void handleSignOut()}><LogOut size={18} aria-hidden="true" /><span className="admin-nav-label">{signOutPending ? "Signing out…" : "Sign out"}</span></button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content side="right" className="admin-tooltip">Sign out</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
      {signOutError && <p role="alert" className="admin-signout-error">{signOutError}</p>}
    </div>
  </>;

  return <Tooltip.Provider delayDuration={180}>
    <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
      <div className="admin-workspace" data-collapsed={collapsed}>
        <a className="admin-skip-link" href="#main-content" onClick={() => mainRef.current?.focus()}>Skip to content</a>
        <aside id="admin-desktop-navigation" className="admin-desktop-sidebar" aria-label="Staff workspace">{sidebarContent(collapsed, false)}</aside>
        <div className="admin-content-shell">
          <header className="admin-topbar">
            <button className="admin-icon-button admin-collapse-toggle" type="button" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="admin-desktop-navigation">{collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}</button>
            <Dialog.Trigger asChild><button ref={menuRef} className="admin-icon-button admin-mobile-toggle" type="button" aria-label="Open navigation"><Menu size={21} /></button></Dialog.Trigger>
            <nav aria-label="Breadcrumb" className="admin-breadcrumb"><Link to="/admin">Workspace</Link>{title !== "Overview" && <><ChevronRight size={14} aria-hidden="true" /><Link to={active?.href ?? "/admin"}>{title}</Link></>}{detail && <><ChevronRight size={14} aria-hidden="true" /><span>Details</span></>}</nav>
            <span className="admin-readonly-label"><span />Read-only access</span>
          </header>
          <main id="main-content" tabIndex={-1} ref={mainRef}><Outlet /></main>
        </div>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="admin-mobile-overlay" />
        <Dialog.Content className="admin-mobile-sidebar" onCloseAutoFocus={(event) => { event.preventDefault(); menuRef.current?.focus(); }}>
          <Dialog.Title className="sr-only">Admin navigation</Dialog.Title>
          <Dialog.Description className="sr-only">Navigate the Venfour staff workspace.</Dialog.Description>
          {sidebarContent(false, true)}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </Tooltip.Provider>;
}
