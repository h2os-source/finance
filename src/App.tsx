import { Fragment, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Bell,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleHelp,
  Coins,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileChartColumnIncreasing,
  FileUp,
  HeartPulse,
  House,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  PiggyBank,
  Settings,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "./api";
import { partitionSelectedStatementRows } from "../server/src/statementImportReview";
import {
  getInsuranceTypeLabel,
  INSURANCE_FREQUENCY_LABELS,
  INSURANCE_TYPE_FIELDS,
  INSURANCE_TYPE_LABELS,
  INSURANCE_TYPES,
  getPolicyRenewalStatus,
  normalizeInsuranceType,
  sortInsurancePolicies,
  type InsuranceDetailField,
  type InsurancePaymentFrequency,
  type InsuranceType,
} from "../server/src/insurance";
import {
  BUDGET_CATEGORIES,
  BUDGET_GROUPS,
  calculateBudgetAllocations,
  calculateBudgetSummary,
  getSavingsGoalWarning,
  monthlyEquivalentCents,
  type BudgetGroup,
} from "../server/src/budget";
import {
  getCurrentPeriodSelection,
  getPeriodRange,
  isCurrentPeriod,
  isDateInPeriod,
  isPeriodCurrentOrFuture,
  navigatePeriod,
  navigateReportingPage,
  selectCurrentPeriod,
  updateReportingPeriod,
  type PeriodRange,
  type PeriodSelection,
  type ReportingPageState,
} from "../server/src/timePeriods";
import type {
  AccountType,
  AuthStatus,
  BudgetBuilderSummary,
  BudgetFrequency,
  BudgetPlan,
  BudgetSourceType,
  DashboardData,
  FinanceEntry,
  FinanceReport,
  FinancialAccount,
  IncomeRecurrence,
  Loan,
  LoanType,
  MortgageSplit,
  PlannerItem,
  PlannerItemInput,
  PlannerKind,
  RecurringIncome,
  Recurrence,
  StatementDestination,
  StatementTransaction,
} from "./types";

const navigation = [
  { label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { label: "Accounts", icon: Wallet, group: "Finances" },
  { label: "Mortgage", icon: House, group: "Finances" },
  { label: "Loans", icon: Coins, group: "Finances" },
  { label: "Super", icon: PiggyBank, group: "Finances" },
  { label: "Income", icon: Banknote, group: "Finances" },
  { label: "Spending", icon: CreditCard, group: "Planning" },
  { label: "Bills", icon: CalendarDays, group: "Planning" },
  { label: "Insurance", icon: ShieldCheck, group: "Planning" },
  { label: "Budgets", icon: ChartNoAxesCombined, group: "Planning" },
  { label: "Reports", icon: FileChartColumnIncreasing, group: "Planning" },
  { label: "Settings", icon: Settings, group: "Personal" },
];

function formatMoney(cents: number, compact = false): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
    notation: compact ? "compact" : "standard",
  }).format(cents / 100);
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    ...options,
  }).format(new Date(`${date}T12:00:00`));
}

function formatMonth(month: string): string {
  return new Intl.DateTimeFormat("en-AU", { month: "short" }).format(
    new Date(`${month}-01T12:00:00`),
  );
}

function formatPeriodBucket(bucket: string, unit: PeriodSelection["unit"]): string {
  if (unit === "financialYear") return formatMonth(bucket);
  return formatDate(bucket, unit === "week"
    ? { weekday: "short", day: "numeric", month: "short" }
    : { day: "numeric", month: "short" });
}

function PeriodSelector({
  selection,
  onChange,
}: {
  selection: PeriodSelection;
  onChange: (selection: PeriodSelection) => void;
}) {
  const range = getPeriodRange(selection);
  const current = isCurrentPeriod(selection);
  return (
    <div className="period-toolbar">
      <div aria-label="Reporting period" className="period-unit-tabs" role="group">
        {([
          ["week", "Week"],
          ["month", "Month"],
          ["financialYear", "Financial Year"],
        ] as const).map(([unit, label]) => (
          <button
            aria-pressed={selection.unit === unit}
            className={selection.unit === unit ? "selected" : ""}
            key={unit}
            onClick={() => onChange({ ...selection, unit })}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="period-navigation">
        <button aria-label="Previous period" className="period-arrow" onClick={() => onChange(navigatePeriod(selection, -1))} type="button">
          <ChevronLeft size={16} />
        </button>
        <strong aria-live="polite">{range.label}</strong>
        <button aria-label="Next period" className="period-arrow" onClick={() => onChange(navigatePeriod(selection, 1))} type="button">
          <ChevronRight size={16} />
        </button>
        <button className="period-current-button" disabled={current} onClick={() => onChange(selectCurrentPeriod(selection))} type="button">
          Current
        </button>
      </div>
    </div>
  );
}

function UpdateControl() {
  const [state, setState] = useState<UpdaterState | null>(null);
  const updater = window.financeUpdater;

  useEffect(() => {
    if (!updater) return;
    void updater.getState().then(setState);
    return updater.onState(setState);
  }, [updater]);

  if (!updater || !state) return null;

  if (state.status === "available") {
    return (
      <button className="primary-button update-button" onClick={() => void updater.install()} type="button">
        <Download size={14} /> Update to v{state.version}
      </button>
    );
  }
  if (state.status === "downloading" || state.status === "ready") {
    return <span className="update-status">Updating… {state.percent}% — the app will restart</span>;
  }
  if (state.status === "checking") return <span className="update-status">Checking for updates…</span>;

  return (
    <>
      {state.message && <span className="update-status">{state.message}</span>}
      <button className="secondary-button update-button" onClick={() => void updater.check()} type="button">
        Check for updates
      </button>
    </>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [pageState, setPageState] = useState<ReportingPageState>(() => ({
    activePage: "Dashboard",
    period: getCurrentPeriodSelection(),
  }));
  const activePage = pageState.activePage;
  const periodSelection = pageState.period;
  const periodRange = getPeriodRange(periodSelection);
  const setActivePage = (page: string) => setPageState((current) => navigateReportingPage(current, page));
  const setPeriodSelection = (period: PeriodSelection) => setPageState((current) => updateReportingPeriod(current, period));
  const [periodReport, setPeriodReport] = useState<FinanceReport | null>(null);
  const [periodReportError, setPeriodReportError] = useState("");
  const [periodReportLoading, setPeriodReportLoading] = useState(true);
  const [periodReportRevision, setPeriodReportRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .authStatus()
      .then(async (status) => {
        setAuth(status);
        if (status.authenticated) setData(await api.dashboard());
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Unable to connect to the local app.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!auth?.authenticated) return;
    let active = true;
    setPeriodReport(null);
    setPeriodReportError("");
    setPeriodReportLoading(true);
    api.report(periodSelection)
      .then((report) => {
        if (active) setPeriodReport(report);
      })
      .catch((reason: unknown) => {
        if (active) setPeriodReportError(reason instanceof Error ? reason.message : "Unable to load period results.");
      })
      .finally(() => {
        if (active) setPeriodReportLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth?.authenticated, periodSelection, periodReportRevision]);

  async function handleAuthenticated() {
    const status = await api.authStatus();
    setAuth(status);
    if (status.authenticated) setData(await api.dashboard());
    setError("");
  }

  async function retryDashboard() {
    setError("");
    try {
      setData(await api.dashboard());
      setPeriodReportRevision((revision) => revision + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load your dashboard.");
    }
  }

  async function refreshDashboardData() {
    const updated = await api.dashboard();
    setData(updated);
    setPeriodReportRevision((revision) => revision + 1);
  }

  async function handleRemoveSampleData() {
    const updated = await api.removeSampleData();
    setData(updated);
    setPeriodReportRevision((revision) => revision + 1);
    setError("");
  }

  async function handleLogout() {
    try {
      await api.logout();
      setAuth((current) =>
        current ? { ...current, authenticated: false, displayName: null } : current,
      );
      setData(null);
      setActivePage("Dashboard");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to lock the dashboard.");
    }
  }

  if (loading) {
    return <div className="loading-screen"><span className="loading-mark" />Loading your local dashboard</div>;
  }

  if (error && !auth) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <Brand />
          <div className="auth-icon auth-icon-warning"><CircleHelp size={23} /></div>
          <h1>Can’t reach your dashboard</h1>
          <p className="auth-copy">{error}</p>
          <button className="primary-button full-button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!auth?.authenticated) {
    return <AuthGate setupRequired={auth?.setupRequired ?? true} onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="household-picker">
          <div className="household-avatar">H</div>
          <div className="household-name"><strong>Home</strong><span>Personal household</span></div>
          <ChevronDown size={15} />
        </div>
        <nav aria-label="Main navigation">
          {["Overview", "Finances", "Planning", "Personal"].map((group) => (
            <div className="nav-group" key={group}>
              <p className="nav-heading">{group}</p>
              {navigation.filter((item) => item.group === group).map(({ label, icon: Icon }) => (
                <button
                  className={`nav-link ${activePage === label ? "active" : ""}`}
                  key={label}
                  onClick={() => setActivePage(label)}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <div className="privacy-icon"><LockKeyhole size={15} /></div>
            <span><strong>Private by design</strong><small>Your data stays on this device</small></span>
          </div>
          <button className="user-menu" onClick={handleLogout}>
            <div className="user-avatar">{auth.displayName?.slice(0, 1).toUpperCase()}</div>
            <span className="user-name"><strong>{auth.displayName}</strong><small>Local account</small></span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Home</span><span className="crumb-separator">/</span><strong>{activePage}</strong></div>
          <div className="topbar-actions">
            <UpdateControl />
            <button className="icon-button" aria-label="Notifications"><Bell size={18} /><i /></button>
            <div className="topbar-divider" />
            <div className="topbar-user">{auth.displayName?.slice(0, 1).toUpperCase()}</div>
          </div>
        </header>
        {["Dashboard", "Income", "Spending", "Bills", "Reports"].includes(activePage) && (
          <PeriodSelector selection={periodSelection} onChange={setPeriodSelection} />
        )}
        {error && data && <div className="app-error" role="alert">{error}</div>}
        {periodReportError && <div className="app-error" role="alert">{periodReportError}</div>}

        {activePage === "Dashboard" ? data ? (
          <Dashboard
            data={data}
            displayName={auth.displayName ?? "there"}
            periodRange={periodRange}
            report={periodReport}
            reportLoading={periodReportLoading}
            onNavigate={setActivePage}
          />
        ) : (
          <DashboardUnavailable error={error} onRetry={retryDashboard} />
        ) : activePage === "Mortgage" ? (
          <MortgagePage onSaved={(mortgages) => {
            const mortgageCents = mortgages.reduce((total, mortgage) => total + mortgage.balanceCents, 0);
            setData((current) => current ? {
              ...current,
              mortgageCents,
              mortgageIsMock: false,
              netPositionCents: current.netPositionCents + current.mortgageCents - mortgageCents,
            } : current);
            void refreshDashboardData();
          }} />
        ) : activePage === "Loans" ? (
          <LoansPage onSaved={refreshDashboardData} />
        ) : activePage === "Accounts" || activePage === "Super" ? (
          <AccountsPage
            key={activePage}
            accountType={activePage === "Super" ? "super" : null}
            onRemoveSampleData={handleRemoveSampleData}
            sampleDataPresent={data?.sampleDataPresent ?? false}
            onSaved={(accounts) => {
            const realAccounts = accounts.filter((account) => !account.isMock);
            const sampleAccounts = accounts.filter((account) => account.isMock);
            const balanceFor = (type: AccountType) => {
              const matchingReal = realAccounts.filter((account) => account.type === type);
              const matching = matchingReal.length
                ? matchingReal
                : sampleAccounts.filter((account) => account.type === type);
              return matching.reduce((total, account) => total + account.balanceCents, 0);
            };
            const cashCents = balanceFor("cash") + balanceFor("offset");
            const offsetCents = balanceFor("offset");
            const superCents = balanceFor("super");
            setData((current) => {
              if (!current) return current;
              const netPositionCents = current.netPositionCents
                - current.cashCents
                - current.superCents
                + cashCents
                + superCents;
              return {
                ...current,
                cashCents,
                offsetCents,
                superCents,
                accountsAreMock: realAccounts.length === 0,
                netPositionCents,
              };
            });
          }} />
        ) : activePage === "Income" || activePage === "Spending" ? (
          <EntriesPage key={activePage} kind={activePage === "Income" ? "income" : "spending"} periodRange={periodRange} onChanged={refreshDashboardData} />
        ) : activePage === "Bills" || activePage === "Insurance" ? (
          <PlannerPage key={activePage} kind={activePage === "Bills" ? "bill" : "insurance"} periodRange={periodRange} onChanged={refreshDashboardData} />
        ) : activePage === "Budgets" ? (
          <BudgetsPage onChanged={refreshDashboardData} />
        ) : activePage === "Reports" ? (
          <ReportsPage periodRange={periodRange} report={periodReport} loading={periodReportLoading} error={periodReportError} />
        ) : (
          activePage === "Settings" ? (
          <SettingsPage
            displayName={auth.displayName ?? ""}
            onLogout={handleLogout}
            onRestored={(restored) => {
              setData(restored);
              setPeriodReportRevision((revision) => revision + 1);
            }}
          />
          ) : (
            <ComingSoonPage page={activePage} onDashboard={() => setActivePage("Dashboard")} />
          )
        )}
        <footer className="page-footer">
          <span><LockKeyhole size={13} /> Your information is stored locally on this device</span>
          <span>Finance dashboard <span className="footer-dot">·</span> Phase 1</span>
        </footer>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark"><span /><span /><span /></div>
      <span>fin<span className="brand-light">ance</span></span>
    </div>
  );
}

function AuthGate({
  setupRequired,
  onAuthenticated,
}: {
  setupRequired: boolean;
  onAuthenticated: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (setupRequired && password !== confirmPassword) {
      setMessage("Your passwords don’t match.");
      return;
    }
    setSubmitting(true);
    try {
      if (setupRequired) await api.setup(displayName, password);
      else await api.login(password);
      await onAuthenticated();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Unable to sign in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <Brand />
        <div className="auth-icon"><LockKeyhole size={22} /></div>
        <h1>{setupRequired ? "Make this space yours" : "Welcome back"}</h1>
        <p className="auth-copy">
          {setupRequired
            ? "Create a local password to keep your household dashboard private."
            : "Enter your local password to see your financial dashboard."}
        </p>
        <form className="auth-form" onSubmit={submit}>
          {setupRequired && (
            <label>
              Your name
              <input autoComplete="name" maxLength={80} onChange={(event) => setDisplayName(event.target.value)} required value={displayName} />
            </label>
          )}
          <label>
            Password
            <input
              autoComplete={setupRequired ? "new-password" : "current-password"}
              minLength={setupRequired ? 12 : undefined}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            {setupRequired && <small>Use at least 12 characters.</small>}
          </label>
          {setupRequired && (
            <label>
              Confirm password
              <input autoComplete="new-password" onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
            </label>
          )}
          {message && <div className="form-error" role="alert">{message}</div>}
          <button className="primary-button full-button" disabled={submitting} type="submit">
            {submitting ? "Please wait…" : setupRequired ? "Create local account" : "Unlock dashboard"}
            {!submitting && <ArrowRight size={16} />}
          </button>
        </form>
        <div className="auth-privacy"><ShieldCheck size={16} /><span>Password is securely hashed. Your data stays on this device.</span></div>
      </div>
    </div>
  );
}

function Dashboard({
  data,
  displayName,
  periodRange,
  report,
  reportLoading,
  onNavigate,
}: {
  data: DashboardData;
  displayName: string;
  periodRange: PeriodRange;
  report: FinanceReport | null;
  reportLoading: boolean;
  onNavigate: (page: string) => void;
}) {
  const firstName = displayName.split(/\s+/)[0] || "there";
  const currentHour = new Date().getHours();
  const salutation = currentHour < 12 ? "Good morning" : currentHour < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const reportIncome = report?.incomeCents ?? 0;
  const reportSpending = report?.spendingCents ?? 0;
  const reportBillsPaid = report?.billsPaidCents ?? 0;
  const reportOutgoings = report?.totalOutgoingsCents ?? 0;
  const reportNet = report?.netCashFlowCents ?? 0;
  const upcomingItems = report?.upcomingItems ?? [];
  const showUpcoming = isPeriodCurrentOrFuture(periodRange);
  const hasPersonalData = data.personalDataPresent;

  if (!data.sampleDataPresent && !hasPersonalData) {
    return (
      <div className="dashboard-page">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">{dateLabel}</div>
            <h1>{salutation}, {firstName}<span className="wave">.</span></h1>
            <p className="welcome-subtitle">Your sample data has been removed.</p>
          </div>
          <span className="demo-badge no-sample-badge"><span /> NO SAMPLE DATA</span>
        </div>
        <section className="panel dashboard-empty-state">
          <span className="dashboard-empty-icon"><Wallet size={23} /></span>
          <h2>No financial details added yet</h2>
          <p>This dashboard is empty. Add your own accounts, mortgage, or other loans to see your balances here. Nothing is pre-filled with sample figures.</p>
          <div className="dashboard-empty-actions">
            <button className="primary-button" onClick={() => onNavigate("Accounts")} type="button">Add accounts <ArrowRight size={15} /></button>
            <button className="secondary-button" onClick={() => onNavigate("Mortgage")} type="button">Add mortgage</button>
            <button className="secondary-button" onClick={() => onNavigate("Loans")} type="button">Add a loan</button>
          </div>
        </section>
        <div className="data-disclaimer"><CircleHelp size={15} /><span>Sample data has been permanently removed from this device. Your dashboard will show only information you enter.</span></div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="welcome-row">
        <div>
          <div className="eyebrow">{dateLabel}</div>
          <h1>{salutation}, {firstName}<span className="wave">.</span></h1>
          <p className="welcome-subtitle">Here’s your household financial snapshot.</p>
        </div>
        <span className={`demo-badge ${data.sampleDataPresent ? "" : "no-sample-badge"}`}><span />{data.sampleDataPresent ? data.accountsAreMock && data.mortgageIsMock ? "SAMPLE DATA" : "MIXED DATA" : data.personalDataPresent ? "YOUR DATA" : "NO SAMPLE DATA"}</span>
      </div>

      <section className="net-worth-card">
        <div className="net-worth-content">
          <div className="card-eyebrow light-eyebrow"><span className="status-dot" /> NET FINANCIAL POSITION</div>
          <div className="net-worth-amount">{formatMoney(data.netPositionCents)}</div>
          <p className="net-worth-description">Cash and super, less recorded loans</p>
          <div className="net-worth-change"><span className="change-pill"><Check size={13} /> {data.sampleDataPresent ? "SAMPLE" : "LOCAL"}</span><span>{data.sampleDataPresent ? "includes fictional sample figures" : data.personalDataPresent ? "your manually entered financial data" : "no sample figures are loaded"}</span></div>
        </div>
        <div className="net-worth-art" aria-hidden="true">
          <div className="art-ring ring-one" /><div className="art-ring ring-two" /><div className="art-ring ring-three" />
          <div className="art-center"><ChartNoAxesCombined size={25} /></div>
          <span className="art-point point-one" /><span className="art-point point-two" /><span className="art-point point-three" />
        </div>
        <div className="net-worth-footer">
          <span><span className="legend-dot mint" /> Cash &amp; offset <strong>{formatMoney(data.cashCents)}</strong></span>
          <span><span className="legend-dot lavender" /> Super <strong>{formatMoney(data.superCents)}</strong></span>
          <span><span className="legend-dot coral" /> Home loan <strong>{formatMoney(data.mortgageCents)}</strong></span>
          <span><span className="legend-dot amber" /> Other loans <strong>{formatMoney(data.otherLoanCents)}</strong></span>
        </div>
      </section>

      <section className="metric-grid" aria-label="Selected period financial results">
        <MetricCard icon={Wallet} title="Cash & offset" amount={data.cashCents} note={`Offset ${formatMoney(data.offsetCents)}`} tone="mint" />
        <MetricCard icon={PiggyBank} title="Super" amount={data.superCents} note="Combined household" tone="lavender" />
        <MetricCard icon={House} title="Mortgage" amount={data.mortgageCents} note={`${data.sampleDataPresent && data.mortgageIsMock ? "Sample loan" : data.mortgageIsMock ? "No loan entered" : "ME home loan"} · Effective ${formatMoney(data.mortgageCents - data.offsetCents)}`} tone="peach" />
        <MetricCard icon={Banknote} title="Income" amount={reportIncome} note={periodRange.label} tone="blue" />
        <MetricCard icon={CreditCard} title="Spending" amount={reportSpending} note={periodRange.label} tone="rose" />
        <MetricCard icon={CalendarDays} title="Bills paid" amount={reportBillsPaid} note={periodRange.label} tone="peach" />
        <MetricCard icon={ArrowUpRight} title="Total outgoings" amount={reportOutgoings} note="Spending + bills paid" tone="rose" />
        <MetricCard icon={ChartNoAxesCombined} title="Net cash flow" amount={reportNet} note="Income - outgoings" tone="mint" />
      </section>
      {reportLoading && <p className="period-report-loading">Loading {periodRange.label} results...</p>}

      {data.propertyCoverage.length > 0 && <section className="panel property-coverage-panel">
        <div className="panel-heading"><div><h2>Home insurance check</h2><p>Building cover compared with your entered property value. Rebuild costs and policy limits may differ.</p></div></div>
        <div className="property-coverage-list">{data.propertyCoverage.map((property) => {
          const coveredRatio = property.propertyValueCents > 0
            ? property.insuredValueCents / property.propertyValueCents
            : 0;
          const status = property.propertyValueCents === 0
            ? "missing-value"
            : property.insuredValueCents === 0
              ? "uninsured"
              : property.gapCents > 0
                ? "underinsured"
                : property.gapCents < 0
                  ? "overinsured"
                  : "matched";
          const statusLabel = status === "missing-value" ? "Add property value"
            : status === "uninsured" ? "No cover recorded"
              : status === "underinsured" ? `Under by ${formatMoney(property.gapCents)}`
                : status === "overinsured" ? `Over by ${formatMoney(Math.abs(property.gapCents))}`
                  : "Cover matches value";
          return <article className="property-coverage-row" key={property.propertyName}>
            <div className="property-coverage-name"><strong>{property.propertyName}</strong><span className={`coverage-status ${status}`}>{statusLabel}</span></div>
            <div className="property-coverage-amounts"><span>Property value <strong>{property.propertyValueCents ? formatMoney(property.propertyValueCents) : "Not set"}</strong></span><span>Building cover <strong>{property.insuredValueCents ? formatMoney(property.insuredValueCents) : "Not set"}</strong></span></div>
            {property.propertyValueCents > 0 && <div className="coverage-track"><span className={status} style={{ width: `${Math.min(100, coveredRatio * 100)}%` }} /></div>}
          </article>;
        })}</div>
      </section>}

      <section className="content-grid">
        <div className="panel trend-panel">
          <div className="panel-heading">
            <div><h2>Cash flow</h2><p>Actual dated results for {periodRange.label}</p></div>
          </div>
          <div className="chart-legend"><span><i className="chart-dot income-dot" /> Income</span><span><i className="chart-dot spending-dot" /> Spending</span><span><i className="chart-dot bills-dot" /> Bills paid</span></div>
          <div className="chart-wrap">
            {!report?.hasActivity ? (
              <div className="dashboard-section-empty">{reportLoading ? "Loading period results..." : "No income, spending or paid bills in this period."}</div>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={report.series} margin={{ top: 12, right: 5, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5d87e8" stopOpacity={0.18} /><stop offset="95%" stopColor="#5d87e8" stopOpacity={0} /></linearGradient>
                  <linearGradient id="spendingFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c4b5fd" stopOpacity={0.22} /><stop offset="95%" stopColor="#c4b5fd" stopOpacity={0} /></linearGradient>
                  <linearGradient id="billsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f1b85a" stopOpacity={0.18} /><stop offset="95%" stopColor="#f1b85a" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid stroke="#edf0f4" vertical={false} />
                <XAxis dataKey="bucket" tickFormatter={(bucket: string) => formatPeriodBucket(bucket, periodRange.unit)} axisLine={false} tickLine={false} tick={{ fill: "#929baa", fontSize: 12 }} dy={10} />
                <YAxis tickFormatter={(value: number) => `$${(value / 100000).toFixed(1)}k`} axisLine={false} tickLine={false} tick={{ fill: "#929baa", fontSize: 11 }} />
                <Tooltip content={<ChartTooltip periodUnit={periodRange.unit} />} />
                <Area type="monotone" dataKey="incomeCents" name="Income" stroke="#5d87e8" strokeWidth={2.5} fill="url(#incomeFill)" />
                <Area type="monotone" dataKey="spendingCents" name="Spending" stroke="#a78bfa" strokeWidth={2.5} fill="url(#spendingFill)" />
                <Area type="monotone" dataKey="billsPaidCents" name="Bills paid" stroke="#e1a843" strokeWidth={2.5} fill="url(#billsFill)" />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
          {report?.hasActivity && <div className="chart-summary">
            <div><span>Income</span><strong>{formatMoney(reportIncome)}</strong></div>
            <div><span>Spending</span><strong>{formatMoney(reportSpending)}</strong></div>
            <div><span>Bills paid</span><strong>{formatMoney(reportBillsPaid)}</strong></div>
          </div>}
        </div>

        {showUpcoming && <div className="panel upcoming-panel">
          <div className="panel-heading">
            <div><h2>Upcoming</h2><p>Due in {periodRange.label} · Bills total {formatMoney(report?.upcomingBillsCents ?? 0)}</p></div>
            <button className="circle-action" aria-label="View all upcoming items"><ArrowRight size={16} /></button>
          </div>
          <div className="upcoming-list">
            {upcomingItems.length === 0 && <div className="dashboard-section-empty">No upcoming bills or renewals in this period.</div>}
            {upcomingItems.map((item) => (
              <div className="upcoming-item" key={item.id}>
                <div className={`upcoming-icon ${item.kind}`} aria-hidden="true">{item.kind === "bill" ? <CalendarDays size={17} /> : <ShieldCheck size={17} />}</div>
                <div className="upcoming-details"><strong>{item.title}</strong><span>{item.kind === "bill" ? "Bill" : "Insurance renewal"} <i /> {formatDate(item.dueDate)}</span></div>
                <strong className="upcoming-amount">{formatMoney(item.amountCents)}</strong>
              </div>
            ))}
          </div>
          <button className="text-link">View all upcoming <ArrowRight size={14} /></button>
        </div>}
      </section>

      <section className="content-grid lower-grid">
        <div className="panel budget-panel">
          <div className="panel-heading">
            <div><h2>Budget check-in</h2><p>A little progress goes a long way</p></div>
            <button className="text-link compact-link">See budgets <ArrowRight size={14} /></button>
          </div>
          <div className="budget-list">
            {data.budgets.length === 0 && <div className="dashboard-section-empty">No budgets entered yet.</div>}
            {data.budgets.map((budget) => {
              const percentage = Math.min(100, Math.round((budget.spentCents / budget.limitCents) * 100));
              return (
                <div className="budget-row" key={budget.category}>
                  <div className="budget-topline"><strong>{budget.category}</strong><span>{formatMoney(budget.spentCents)} <i>of</i> {formatMoney(budget.limitCents)}</span></div>
                  <div className="budget-track"><span className={percentage >= 95 ? "near-limit" : ""} style={{ width: `${percentage}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="panel snapshot-panel">
          <div className="panel-heading">
            <div><h2>{periodRange.label} at a glance</h2><p>Actual income and outgoings</p></div>
          </div>
          <div className="snapshot-list">
            <div><span className="snapshot-icon income-snapshot"><ArrowDownRight size={16} /></span><span className="snapshot-label">Income</span><strong>{formatMoney(reportIncome)}</strong></div>
            <div><span className="snapshot-icon spending-snapshot"><ArrowUpRight size={16} /></span><span className="snapshot-label">Total outgoings</span><strong>{formatMoney(reportOutgoings)}</strong></div>
            <div><span className="snapshot-icon surplus-snapshot"><Check size={16} /></span><span className="snapshot-label">Net cash flow</span><strong className={reportNet >= 0 ? "positive" : ""}>{formatMoney(reportNet)}</strong></div>
          </div>
          {report?.hasActivity && reportIncome > 0
            ? <div className="snapshot-note"><span className="note-sparkle">✦</span><span>Net cash flow is <strong>{Math.round((reportNet / reportIncome) * 100)}%</strong> of recorded income for this period.</span></div>
            : <div className="dashboard-section-empty snapshot-empty">{reportLoading ? "Loading period results..." : "No actual income or outgoings in this period."}</div>}
        </div>
      </section>

      <div className="data-disclaimer"><CircleHelp size={15} /><span>{data.sampleDataPresent ? data.accountsAreMock && data.mortgageIsMock ? "These are fictional sample figures. Remove them at any time in Settings." : `Some dashboard data is manually entered${data.accountsAreMock ? "" : " for your accounts"}${data.mortgageIsMock ? "" : " and mortgage"}; remaining figures are samples. Remove samples in Settings.` : !data.accountsAreMock || !data.mortgageIsMock ? "Sample data has been removed. Only manually entered account and mortgage balances are shown; other sections are empty." : "Sample data has been removed. Add your own account or mortgage details to see them here."}</span><span className="updated-at">Updated {new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" }).format(new Date(data.updatedAt))}</span></div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  title,
  amount,
  note,
  tone,
}: {
  icon: typeof Wallet;
  title: string;
  amount: number;
  note: string;
  tone: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top"><span className={`metric-icon ${tone}`}><Icon size={17} strokeWidth={1.8} /></span><span className="metric-title">{title}</span><ArrowUpRight className="metric-trend" size={15} /></div>
      <strong className="metric-amount">{formatMoney(amount, true)}</strong>
      <span className="metric-note">{note}</span>
    </article>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  periodUnit,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  periodUnit: PeriodSelection["unit"];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label ? formatPeriodBucket(label, periodUnit) : ""}</strong>
      {payload.map((item) => <span key={item.name}><i style={{ backgroundColor: item.color }} />{item.name}<b>{formatMoney(item.value)}</b></span>)}
    </div>
  );
}

function SettingsPage({
  displayName,
  onLogout,
  onRestored,
}: {
  displayName: string;
  onLogout: () => Promise<void>;
  onRestored: (data: DashboardData) => void;
}) {
  const backupInput = useRef<HTMLInputElement>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState("");
  const [transferError, setTransferError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordMessage("");
    setPasswordBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword, confirmNewPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPasswordMessage("Password changed successfully.");
    } catch (reason) {
      setPasswordError(reason instanceof Error ? reason.message : "The password could not be changed.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function downloadBackup() {
    setTransferBusy(true);
    setTransferMessage("");
    setTransferError("");
    try {
      const backup = await api.downloadBackup();
      const url = URL.createObjectURL(backup);
      const link = document.createElement("a");
      link.href = url;
      link.download = `finance-dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTransferMessage("Backup downloaded.");
    } catch (reason) {
      setTransferError(reason instanceof Error ? reason.message : "The backup could not be downloaded.");
    } finally {
      setTransferBusy(false);
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !window.confirm("Restore this backup? It will replace all finance data on this PC. Your local login will stay unchanged.")) return;

    setTransferBusy(true);
    setTransferMessage("");
    setTransferError("");
    try {
      const backup = JSON.parse(await file.text()) as unknown;
      onRestored(await api.restoreBackup(backup));
      setTransferMessage("Backup restored.");
    } catch (reason) {
      setTransferError(reason instanceof Error ? reason.message : "The backup could not be restored.");
    } finally {
      setTransferBusy(false);
    }
  }

  return (
    <div className="secondary-page">
      <div className="welcome-row"><div><div className="eyebrow">PERSONALISE YOUR SPACE</div><h1>Settings</h1><p className="welcome-subtitle">Your dashboard preferences and local security.</p></div></div>
      <section className="panel settings-panel">
        <div className="settings-section-title"><div className="settings-section-icon"><Settings size={18} /></div><div><h2>Profile</h2><p>Details for your local household account.</p></div></div>
        <label className="settings-field">Display name<input value={displayName} readOnly /></label>
        <div className="settings-divider" />
        <div className="settings-section-title"><div className="settings-section-icon security-setting-icon"><ShieldCheck size={18} /></div><div><h2>Privacy &amp; security</h2><p>Your dashboard is only available on this computer.</p></div></div>
        <div className="security-status"><span><LockKeyhole size={17} /></span><div><strong>Password protection is on</strong><small>Your password is securely hashed and never stored as plain text.</small></div><span className="enabled-pill"><Check size={13} /> Enabled</span></div>
        <div className="security-status"><span><House size={17} /></span><div><strong>Local-only connection</strong><small>The app listens on this computer and is not exposed to your network.</small></div><span className="enabled-pill"><Check size={13} /> Private</span></div>
        <div className="settings-divider" />
        <div className="settings-section-title"><div className="settings-section-icon security-setting-icon"><LockKeyhole size={18} /></div><div><h2>Change password</h2><p>Confirm your current password before choosing a new one.</p></div></div>
        <form className="settings-password-form" onSubmit={changePassword}>
          <label className="settings-field">Current password<input autoComplete="current-password" maxLength={256} onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} /></label>
          <label className="settings-field">New password<input autoComplete="new-password" maxLength={256} minLength={12} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /></label>
          <label className="settings-field">Confirm new password<input autoComplete="new-password" maxLength={256} minLength={12} onChange={(event) => setConfirmNewPassword(event.target.value)} required type="password" value={confirmNewPassword} /></label>
          {passwordError && <div className="form-error" role="alert">{passwordError}</div>}
          {passwordMessage && <div className="mortgage-success" role="status">{passwordMessage}</div>}
          <button className="primary-button" disabled={passwordBusy} type="submit">{passwordBusy ? "Changing password..." : "Change password"}</button>
        </form>
        <div className="settings-divider" />
        <div className="settings-section-title"><div className="settings-section-icon"><Download size={18} /></div><div><h2>Data portability</h2><p>Move your household data to another computer.</p></div></div>
        <div className="settings-transfer-actions">
          <button className="primary-button" disabled={transferBusy} onClick={downloadBackup}><Download size={15} /> Download backup</button>
          <button className="secondary-button" disabled={transferBusy} onClick={() => backupInput.current?.click()}><FileUp size={15} /> Restore backup</button>
          <input ref={backupInput} hidden type="file" accept=".json,application/json" onChange={restoreBackup} />
        </div>
        <p className="settings-transfer-note">On the other computer, sign in or create a local account, then restore the downloaded file. It contains sensitive financial information; keep it private.</p>
        {transferMessage && <p className="settings-transfer-message" role="status">{transferMessage}</p>}
        {transferError && <p className="settings-transfer-error" role="alert">{transferError}</p>}
        <div className="settings-divider" />
        <div className="settings-section-title"><div className="settings-section-icon"><HeartPulse size={18} /></div><div><h2>Financial year</h2><p>Australian financial year runs from 1 July to 30 June.</p></div></div>
        <div className="settings-readonly"><span>Financial year</span><strong>Australian (July – June)</strong></div>
        <div className="settings-actions">
          <button className="secondary-button" onClick={async () => { await onLogout(); }}>Lock dashboard <LogOut size={15} /></button>
          <span className="settings-readonly-note">More profile options are coming in a later phase.</span>
        </div>
      </section>
    </div>
  );
}

interface AccountDraft {
  accountId?: number;
  institution: string;
  name: string;
  websiteUrl: string;
  bsb: string;
  accountNumber: string;
  notes: string;
  type: AccountType;
  balance: string;
}

function newAccountDraft(type: AccountType = "cash"): AccountDraft {
  return { institution: "", name: "", websiteUrl: "", bsb: "", accountNumber: "", notes: "", type, balance: "" };
}

function isSafeWebsiteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function AccountsPage({
  accountType,
  onRemoveSampleData,
  sampleDataPresent,
  onSaved,
}: {
  accountType: AccountType | null;
  onRemoveSampleData: () => Promise<void>;
  sampleDataPresent: boolean;
  onSaved: (accounts: FinancialAccount[]) => void;
}) {
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [drafts, setDrafts] = useState<AccountDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [removingSamples, setRemovingSamples] = useState(false);

  useEffect(() => {
    api.accounts()
      .then((loaded) => {
        setAccounts(loaded);
        setDrafts(loaded.filter((account) =>
          !account.isMock && (accountType === null || account.type === accountType),
        ).map((account) => ({
          accountId: account.id,
          institution: account.institution,
          name: account.name,
          websiteUrl: account.websiteUrl,
          bsb: account.bsb,
          accountNumber: account.accountNumber,
          notes: account.notes,
          type: account.type,
          balance: (account.balanceCents / 100).toFixed(2),
        })));
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Unable to load your accounts.");
      })
      .finally(() => setLoading(false));
  }, [accountType]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const editedAccounts = drafts.map((account) => ({
        institution: account.institution,
        name: account.name,
        websiteUrl: account.type === "super" ? account.websiteUrl : "",
        bsb: account.type === "super" ? "" : account.bsb,
        accountNumber: account.type === "super" ? "" : account.accountNumber,
        notes: account.notes,
        type: account.type,
        balanceCents: Math.round(Number(account.balance) * 100),
      }));
      const unchangedAccounts = accountType === null
        ? []
        : accounts
          .filter((account) => !account.isMock && account.type !== accountType)
          .map(({ institution, name, websiteUrl, bsb, accountNumber, notes, type, balanceCents }) => ({
            institution,
            name,
            websiteUrl,
            bsb,
            accountNumber,
            notes,
            type,
            balanceCents,
          }));
      const updated = await api.saveAccounts([...unchangedAccounts, ...editedAccounts]);
      setAccounts(updated);
      setMessage("Your accounts have been saved on this device.");
      onSaved(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save your accounts.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(account: FinancialAccount) {
    const confirmMessage = account.isMock
      ? `Remove the sample account “${account.name}” from ${account.institution}? This removes only that sample account.`
      : `Delete “${account.name}” from ${account.institution}? This cannot be undone.`;
    if (!window.confirm(confirmMessage)) return;
    setError("");
    setMessage("");
    try {
      const updated = account.isMock
        ? await api.removeSampleAccount(account.id)
        : await api.removeAccount(account.id);
      setAccounts(updated);
      setDrafts((current) => current.filter((draft) => draft.accountId !== account.id));
      setMessage(`${account.name} has been deleted.`);
      onSaved(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete this account.");
    }
  }

  async function removeAllSamples() {
    if (!sampleDataPresent || removingSamples) return;
    const confirmed = window.confirm(
      "Permanently remove all fictional sample accounts, mortgage, income, spending, bills and budgets? Your manually entered accounts and mortgage splits will be kept.",
    );
    if (!confirmed) return;
    setRemovingSamples(true);
    setError("");
    setMessage("");
    try {
      await onRemoveSampleData();
      const updated = await api.accounts();
      setAccounts(updated);
      setMessage("All sample data has been removed. Your manually entered accounts were kept.");
      onSaved(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to remove sample data.");
    } finally {
      setRemovingSamples(false);
    }
  }

  const accountTypeLabel = (type: AccountType) => ({
    cash: "Cash",
    offset: "Offset",
    super: "Super",
  })[type];
  const visibleAccounts = accountType === null
    ? accounts
    : accounts.filter((account) => account.type === accountType);
  const pageTitle = accountType === "super" ? "Super" : "Accounts";
  const subtitle = accountType === "super"
    ? "View and update your superannuation accounts and balances."
    : "Keep accounts from multiple banks and funds together in one place.";

  const renderAccountCard = (account: FinancialAccount) => (
    <article className={`account-card ${account.isMock ? "sample-account" : ""}`} key={`${account.isMock ? "sample" : "saved"}-${account.id}`}>
      <span className="account-card-icon"><Building2 size={17} /></span>
      <div className="account-card-info">
        <strong>{account.name}</strong>
        <span>{account.institution || "Sample institution"} · {accountTypeLabel(account.type)}</span>
        {account.type === "super" && account.websiteUrl && isSafeWebsiteUrl(account.websiteUrl) && (
          <a className="account-website-link" href={account.websiteUrl} rel="noreferrer" target="_blank">Fund website <ExternalLink size={12} /></a>
        )}
        {account.type !== "super" && (account.bsb || account.accountNumber) && (
          <span>{[account.bsb && `BSB ${account.bsb}`, account.accountNumber && `Acc ${account.accountNumber}`].filter(Boolean).join(" · ")}</span>
        )}
        {account.notes && <span className="account-notes">Notes: {account.notes}</span>}
      </div>
      <strong className="account-card-balance">{formatMoney(account.balanceCents)}</strong>
      {account.isMock && <span className="sample-account-tag">SAMPLE</span>}
      <button className="account-delete-button" onClick={() => void deleteAccount(account)} type="button">{account.isMock ? "Remove sample" : "Delete"}</button>
    </article>
  );
  const bankAccounts = visibleAccounts.filter((account) => account.type !== "super");
  const superAccounts = visibleAccounts.filter((account) => account.type === "super");
  const accountGroups = accountType === null
    ? [{ title: "Bank accounts", items: bankAccounts, empty: "No bank accounts added yet." }, { title: "Super accounts", items: superAccounts, empty: "No super accounts added yet." }]
    : [];

  return (
    <div className="secondary-page">
      <div className="welcome-row">
        <div>
          <div className="eyebrow">{accountType === "super" ? "YOUR SUPERANNUATION" : "YOUR FINANCIAL ACCOUNTS"}</div>
          <h1>{pageTitle}</h1>
          <p className="welcome-subtitle">{subtitle}</p>
        </div>
      </div>
      <section className="panel accounts-panel">
        <div className="mortgage-notice">
          <LockKeyhole size={17} />
          <p><strong>Manual entry only</strong><span>{accountType === "super" ? "Add your super fund and account details here. This does not connect to your fund; never enter account passwords." : "Add the institution and account name for each account. This does not connect to your bank; never enter banking passwords."}</span></p>
        </div>
        {accountType === null && sampleDataPresent && (
          <div className="accounts-sample-warning">
            <div>
              <strong>Sample accounts are not real</strong>
              <span>Remove all fictional sample data from every tab. Your manually entered data is kept.</span>
            </div>
            <button className="remove-sample-button" disabled={removingSamples} onClick={() => void removeAllSamples()} type="button">
              {removingSamples ? "Removing…" : "Remove all sample data"}
            </button>
          </div>
        )}
        <div className="accounts-list">
          <h2>{accountType === "super" ? "Super accounts on this device" : "Accounts on this device"}</h2>
          {loading ? <p className="mortgage-status">Loading accounts…</p> : accountType === null ? (
            accounts.length === 0 ? <p className="mortgage-status">No accounts to show yet. Add one below to get started.</p> : accountGroups.map((group) => (
              <div className="account-group" key={group.title}>
                <h3 className="account-group-title">{group.title} <span>{formatMoney(group.items.reduce((sum, item) => sum + item.balanceCents, 0))}</span></h3>
                {group.items.length === 0 ? <p className="mortgage-status">{group.empty}</p> : group.items.map(renderAccountCard)}
              </div>
            ))
          ) : visibleAccounts.length === 0 ? (
            <p className="mortgage-status">No super accounts added yet. Add a super fund below to get started.</p>
          ) : visibleAccounts.map(renderAccountCard)}
        </div>
        <div className="accounts-divider" />
        <form className="accounts-form" onSubmit={submit}>
          <div className="accounts-form-heading">
            <div><h2>{accountType === "super" ? "Your super funds" : "Your accounts"}</h2><p>{accountType === "super" ? "Add one entry for each super fund account." : "Add an account for each bank, offset account, or super fund."}</p></div>
            <button className="secondary-button add-split-button" disabled={loading} onClick={() => setDrafts((current) => [...current, newAccountDraft(accountType ?? "cash")])} type="button">{accountType === "super" ? "+ Add super account" : "+ Add account"}</button>
          </div>
          {drafts.map((account, index) => (
            <fieldset className="account-edit-card" key={index}>
              <legend>{accountType === "super" ? `Super account ${index + 1}` : `Account ${index + 1}`}</legend>
              <button className="remove-split-button" onClick={() => setDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">Remove</button>
              <label>
                {account.type === "super" ? "Super fund" : "Bank or institution"}
                <input autoComplete="organization" maxLength={80} onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, institution: event.target.value } : item))} placeholder={account.type === "super" ? "e.g. AustralianSuper" : "e.g. ME Bank"} required value={account.institution} />
              </label>
              <label>
                Account name
                <input maxLength={80} onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="e.g. Everyday account" required value={account.name} />
              </label>
              {account.type === "super" ? (
                <label>
                  Fund website (optional)
                  <input autoComplete="url" maxLength={2048} onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, websiteUrl: event.target.value } : item))} placeholder="https://www.example.com.au" type="url" value={account.websiteUrl} />
                </label>
              ) : (
                <>
                  <label>
                    BSB (optional)
                    <input autoComplete="off" inputMode="numeric" maxLength={7} onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, bsb: event.target.value } : item))} pattern="\d{3}-?\d{3}" placeholder="e.g. 123-456" title="6 digits, for example 123-456" value={account.bsb} />
                  </label>
                  <label>
                    Account number (optional)
                    <input autoComplete="off" maxLength={20} onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, accountNumber: event.target.value } : item))} placeholder="e.g. 12345678" value={account.accountNumber} />
                  </label>
                </>
              )}
              {accountType !== "super" && (
                <label>
                  Account type
                  <select onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as AccountType } : item))} value={account.type}>
                    <option value="cash">Cash or savings</option>
                    <option value="offset">Mortgage offset</option>
                    <option value="super">Super</option>
                  </select>
                </label>
              )}
              <label>
                Balance (AUD)
                <span className="money-input"><span>$</span><input inputMode="decimal" max="1000000000" min="-1000000000" onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, balance: event.target.value } : item))} placeholder="e.g. 5,000" required step="0.01" type="number" value={account.balance} /></span>
              </label>
              <label className="entry-description-field">
                Notes (optional)
                <textarea maxLength={500} onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, notes: event.target.value } : item))} placeholder="e.g. member number, insurance inside super, who to call" rows={2} value={account.notes} />
              </label>
            </fieldset>
          ))}
          {error && <div className="form-error" role="alert">{error}</div>}
          {message && <div className="mortgage-success" role="status">{message}</div>}
          {drafts.length > 0 && (
            <div className="mortgage-actions">
              <button className="primary-button" disabled={loading || saving} type="submit">{saving ? "Saving…" : accountType === "super" ? "Save super accounts" : "Save accounts"} <ArrowRight size={15} /></button>
              {accounts.some((account) => !account.isMock) && <span>Saving replaces your current manually entered account list.</span>}
            </div>
          )}
        </form>
      </section>
    </div>
  );
}

function todayInputDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

type ImportRow = StatementTransaction & { selected: boolean };

function extractBillDetails(description: string): { name: string; provider: string } {
  let cleaned = description
    .replace(/^WITHDRAWAL\s+(?:ONLINE|MOBILE|MERCHANT)?\s*\d*\s*/i, "")
    .replace(/^PAYMENT\s+(?:BY\s+AUTHORITY\s+TO|TO)?\s*/i, "")
    .replace(/^BPAY\s+/i, "")
    .replace(/\s+\d{6,}$/i, "")
    .trim();
  if (!cleaned) cleaned = description.trim();

  let provider = "";
  if (/optus/i.test(cleaned)) provider = "Optus";
  else if (/telstra/i.test(cleaned)) provider = "Telstra";
  else if (/vodafone/i.test(cleaned)) provider = "Vodafone";
  else if (/synergy/i.test(cleaned)) provider = "Synergy";
  else if (/alinta/i.test(cleaned)) provider = "Alinta Energy";
  else if (/agl/i.test(cleaned)) provider = "AGL";
  else if (/origin/i.test(cleaned)) provider = "Origin Energy";
  else if (/water/i.test(cleaned)) provider = "Water Corporation";
  else if (/kwinana/i.test(cleaned)) provider = "City of Kwinana";
  else if (/raci?|rac\b/i.test(cleaned)) provider = "RAC";
  else provider = cleaned.split(/\s+/)[0] || "Bill";

  return { name: cleaned, provider };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("That file could not be opened."));
    reader.readAsDataURL(file);
  });
}

function StatementImport({ onImported }: { onImported: () => Promise<void> }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const { transactions } = await api.previewStatementPdf(await readFileAsBase64(file));
      if (transactions.length === 0) {
        setRows(null);
        setError("No transactions were found in that PDF. Scanned or photographed statements can't be read - download the PDF from your bank's website instead.");
      } else {
        setRows(transactions.map((row) => ({
          ...row,
          destination: row.destination ?? (row.direction === "in" ? "income" : row.category === "Bills" ? "bill" : "spending"),
          selected: !row.possibleDuplicate,
        })));
      }
    } catch (reason) {
      setRows(null);
      setError(reason instanceof Error ? reason.message : "That PDF could not be read.");
    } finally {
      setBusy(false);
    }
  }

  function update(index: number, change: Partial<ImportRow>) {
    setRows((current) => current?.map((row, i) => (i === index ? { ...row, ...change } : row)) ?? null);
  }

  async function importSelected() {
    const { entries: entryRows, bills: billRows } = partitionSelectedStatementRows(rows ?? []);
    if (entryRows.length === 0 && billRows.length === 0) return;
    setError("");
    setBusy(true);
    try {
      const entriesToImport = entryRows.map((row) => ({
        kind: row.destination === "income" ? ("income" as const) : ("spending" as const),
        amountCents: row.amountCents,
        category: row.category.trim() || (row.destination === "income" ? "Income" : "Other"),
        description: row.description.slice(0, 200),
        entryDate: row.date,
      }));

      const billsToImport = billRows.map((row) => {
        const { name, provider } = extractBillDetails(row.description);
        return {
          name: name || row.description.slice(0, 100),
          provider: provider || "Bill",
          amountCents: row.amountCents,
          transactionDate: row.date,
          notes: row.description.slice(0, 200),
        };
      });

      const { imported, importedIncome, importedSpending, importedBills, failures } = await api.importEntries({
        entries: entriesToImport,
        bills: billsToImport,
      });

      setRows(failures.length > 0
        ? (current) => current?.map((row) => ({ ...row, selected: false })) ?? null
        : null);
      const summaryParts: string[] = [];
      if (importedSpending > 0) summaryParts.push(`${importedSpending} to Spending`);
      if (importedIncome > 0) summaryParts.push(`${importedIncome} deposits to Income`);
      if (importedBills > 0) summaryParts.push(`${importedBills} bills moved to Bills tab`);
      setMessage(`Imported: ${summaryParts.join(", ") || "Transactions saved"}.`);
      if (failures.length > 0) {
        const failureSummary = [...new Set(failures.map((failure) => {
          const destination = failure.destination === "bill" ? "Bills" : failure.destination === "income" ? "Income" : "Spending";
          return `${destination}: ${failure.message}`;
        }))].join(" ");
        setError(`${imported + importedBills} transaction(s) imported; some selected transactions were not imported. ${failureSummary}`);
      }
      await onImported();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The transactions could not be imported.");
    } finally {
      setBusy(false);
    }
  }

  const { entries: selectedEntries, bills: selectedBills } = partitionSelectedStatementRows(rows ?? []);
  const importableCount = selectedEntries.length + selectedBills.length;

  return (
    <section className="panel statement-import">
      <div className="panel-heading">
        <div>
          <h2>Import from a bank statement PDF</h2>
          <p>Deposits are saved as Income, bills move to the Bills tab, and withdrawals are saved as Spending. Check and adjust the destination for any transaction before importing.</p>
        </div>
        <button className="secondary-button" disabled={busy} onClick={() => fileInput.current?.click()} type="button">{busy ? "Reading…" : "Choose PDF"}</button>
        <input accept="application/pdf,.pdf" hidden onChange={(event) => void choose(event)} ref={fileInput} type="file" />
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="mortgage-success" role="status">{message}</div>}
      {rows && (
        <>
          <div className="statement-bulk-actions">
            <button className="secondary-button" onClick={() => setRows((current) => current?.map((row) => ({ ...row, selected: true })) ?? null)} type="button">Check all</button>
            <button className="secondary-button" onClick={() => setRows((current) => current?.map((row) => ({ ...row, selected: false })) ?? null)} type="button">Uncheck all</button>
          </div>
          <div className="statement-table-wrap">
            <table className="statement-table">
              <thead><tr><th>Add</th><th>Date</th><th>Description</th><th>Destination</th><th>Category</th><th>Amount</th></tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr className={row.selected ? "" : "statement-row-off"} key={index}>
                    <td><input aria-label={`Import ${row.description}`} checked={row.selected} onChange={(event) => update(index, { selected: event.target.checked })} type="checkbox" /></td>
                    <td>{formatDate(row.date, { year: "numeric" })}</td>
                    <td>
                      <div>{row.description}</div>
                      {row.destination === "income" && <em className="badge-income"> · deposit → Income</em>}
                      {row.destination === "bill" && <em className="badge-bill"> · move to Bills tab</em>}
                      {row.destination === "spending" && <em className="badge-spending"> · Spending</em>}
                      {row.destination === "ignore" && <em> · Ignore (not imported)</em>}
                      {row.possibleDuplicate && <em> · may already be saved</em>}
                    </td>
                    <td>
                      <select
                        aria-label="Destination"
                        value={row.destination}
                        onChange={(event) => {
                          const nextDest = event.target.value as StatementDestination;
                          update(index, {
                            destination: nextDest,
                            category: nextDest === "ignore" ? row.category : nextDest === "income" ? "Income" : nextDest === "bill" ? "Bills" : row.category === "Income" ? "Other" : row.category,
                          });
                        }}
                      >
                        <option value="spending">Spending</option>
                        <option value="income">Income (Deposit)</option>
                        <option value="bill">Bills tab (Bill)</option>
                        <option value="ignore">Ignore</option>
                      </select>
                    </td>
                    <td><input aria-label="Category" disabled={row.destination === "ignore"} maxLength={80} onChange={(event) => update(index, { category: event.target.value })} value={row.category} /></td>
                    <td>{formatMoney(row.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="finance-form-actions">
            <button className="primary-button" disabled={busy || importableCount === 0} onClick={() => void importSelected()} type="button">Import {importableCount} {importableCount === 1 ? "transaction" : "transactions"}</button>
            <button className="secondary-button" onClick={() => setRows(null)} type="button">Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}

function EntriesPage({ kind, periodRange, onChanged }: { kind: "income" | "spending"; periodRange: PeriodRange; onChanged: () => Promise<void> }) {
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [recurringItems, setRecurringItems] = useState<RecurringIncome[]>([]);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState(todayInputDate);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState<IncomeRecurrence>("monthly");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingRecurringId, setEditingRecurringId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingAllSpending, setDeletingAllSpending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pageTitle = kind === "income" ? "Income" : "Spending";

  async function loadEntries() {
    const list = await api.entries(kind);
    setEntries(list);
    if (kind === "income") {
      const schedules = await api.recurringIncome();
      setRecurringItems(schedules);
    }
  }

  useEffect(() => {
    loadEntries()
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : `Unable to load ${kind} entries.`))
      .finally(() => setLoading(false));
  }, [kind]);

  function resetEntryForm() {
    setAmount("");
    setCategory("");
    setDescription("");
    setEntryDate(todayInputDate());
    setEditingId(null);
    setEditingRecurringId(null);
    setIsRecurring(false);
    setRecurrence("monthly");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    const entry = {
      kind,
      amountCents: Math.round(Number(amount) * 100),
      category,
      description,
      entryDate,
    };
    try {
      if (kind === "income" && isRecurring) {
        const schedule = {
          amountCents: entry.amountCents,
          category: entry.category,
          description: entry.description,
          nextDate: entry.entryDate,
          recurrence,
        };
        if (editingRecurringId === null) await api.createRecurringIncome(schedule);
        else await api.updateRecurringIncome(editingRecurringId, schedule);
      } else if (editingId === null) await api.createEntry(entry);
      else await api.updateEntry(editingId, entry);
      await loadEntries();
      await onChanged();
      setMessage(kind === "income" && isRecurring
        ? `Recurring income ${editingRecurringId === null ? "added" : "updated"}.`
        : `${pageTitle} entry ${editingId === null ? "added" : "updated"}.`);
      resetEntryForm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to save ${kind} entry.`);
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(entry: FinanceEntry) {
    if (!window.confirm(`Delete this ${kind} entry for ${formatMoney(entry.amountCents)}?`)) return;
    setError("");
    try {
      await api.deleteEntry(entry.id);
      await loadEntries();
      await onChanged();
      if (editingId === entry.id) resetEntryForm();
      setMessage("Entry deleted.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete this entry.");
    }
  }

  async function removeAllSpendingEntries() {
    if (kind !== "spending" || entries.length === 0) return;
    if (!window.confirm(`Delete all ${entries.length} spending entries? This cannot be undone.`)) return;
    setError("");
    setMessage("");
    setDeletingAllSpending(true);
    try {
      const { deleted } = await api.deleteAllSpendingEntries();
      await loadEntries();
      await onChanged();
      if (editingId !== null) resetEntryForm();
      setMessage(`${deleted} spending ${deleted === 1 ? "entry" : "entries"} deleted.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete Spending entries.");
    } finally {
      setDeletingAllSpending(false);
    }
  }

  async function removeRecurringIncome(item: RecurringIncome) {
    if (!window.confirm(`Delete recurring ${item.category} income of ${formatMoney(item.amountCents)}?`)) return;
    setError("");
    try {
      await api.deleteRecurringIncome(item.id);
      await loadEntries();
      await onChanged();
      if (editingRecurringId === item.id) resetEntryForm();
      setMessage("Recurring income deleted.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete recurring income.");
    }
  }

  function editEntry(entry: FinanceEntry) {
    setEditingId(entry.id);
    setEditingRecurringId(null);
    setIsRecurring(false);
    setAmount((entry.amountCents / 100).toFixed(2));
    setCategory(entry.category);
    setDescription(entry.description);
    setEntryDate(entry.entryDate);
    setMessage("");
  }

  function editRecurringIncome(item: RecurringIncome) {
    setEditingId(null);
    setEditingRecurringId(item.id);
    setIsRecurring(true);
    setAmount((item.amountCents / 100).toFixed(2));
    setCategory(item.category);
    setDescription(item.description);
    setEntryDate(item.nextDate);
    setRecurrence(item.recurrence);
    setMessage("");
  }

  const periodEntries = entries.filter((entry) => isDateInPeriod(entry.entryDate, periodRange));
  const periodTotal = periodEntries.reduce((total, entry) => total + entry.amountCents, 0);

  return (
    <div className="secondary-page">
      <div className="welcome-row">
        <div><div className="eyebrow">YOUR HOUSEHOLD CASH FLOW</div><h1>{pageTitle}</h1><p className="welcome-subtitle">Enter dated transactions to build your monthly totals, dashboard charts and reports.</p></div>
        <span className="demo-badge no-sample-badge"><span /> YOUR DATA</span>
      </div>
      <div className="finance-summary-strip"><span>{pageTitle} · {periodRange.label}</span><strong>{formatMoney(periodTotal)}</strong><span>{periodEntries.length} {periodEntries.length === 1 ? "entry" : "entries"} in period · {entries.length} saved total</span></div>
      <section className="panel finance-entry-panel">
        <div className="panel-heading"><div><h2>{editingId === null ? `Add ${kind} entry` : `Edit ${kind} entry`}</h2><p>Entries are for reports and charts only; they do not change account balances.</p></div></div>
        <form className="finance-entry-form" onSubmit={submit}>
          <label>Amount (AUD)<span className="money-input"><span>$</span><input inputMode="decimal" max="1000000000" min="0.01" onChange={(event) => setAmount(event.target.value)} required step="0.01" type="number" value={amount} /></span></label>
          <label>{kind === "income" ? "Source or category" : "Category"}<input maxLength={80} onChange={(event) => setCategory(event.target.value)} placeholder={kind === "income" ? "e.g. Salary" : "e.g. Groceries"} required value={category} /></label>
          <label>{isRecurring ? "Next payment date" : "Date"}<input onChange={(event) => setEntryDate(event.target.value)} required type="date" value={entryDate} /></label>
          <label className="entry-description-field">Notes (optional)<input maxLength={200} onChange={(event) => setDescription(event.target.value)} placeholder="Add a short note" value={description} /></label>
          {kind === "income" && <label className="recurring-income-toggle"><input checked={isRecurring} onChange={(event) => {
            setIsRecurring(event.target.checked);
            setEditingId(null);
            setEditingRecurringId(null);
          }} type="checkbox" /> This is recurring income</label>}
          {kind === "income" && isRecurring && <label>Frequency<select onChange={(event) => setRecurrence(event.target.value as IncomeRecurrence)} value={recurrence}>
            <option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
          </select></label>}
          {error && <div className="form-error" role="alert">{error}</div>}
          {message && <div className="mortgage-success" role="status">{message}</div>}
          <div className="finance-form-actions">
            <button className="primary-button" disabled={saving}>{saving ? "Saving…" : isRecurring ? editingRecurringId === null ? "Add recurring income" : "Update recurring income" : editingId === null ? `Add ${kind}` : "Update entry"} <ArrowRight size={15} /></button>
            {(editingId !== null || editingRecurringId !== null) && <button className="secondary-button" onClick={resetEntryForm} type="button">Cancel edit</button>}
          </div>
        </form>
      </section>
      {kind === "spending" && <StatementImport onImported={async () => { await loadEntries(); await onChanged(); }} />}
      <section className="panel finance-list-panel">
        <div className="panel-heading">
          <div><h2>Entries</h2><p>Most recent first · {periodRange.label}</p></div>
          {kind === "spending" && (
            <button className="account-delete-button spending-delete-all-button" disabled={loading || deletingAllSpending || entries.length === 0} onClick={() => void removeAllSpendingEntries()} type="button">
              {deletingAllSpending ? "Deleting…" : "Delete all"}
            </button>
          )}
        </div>
        {loading ? <p className="mortgage-status">Loading entries…</p> : periodEntries.length === 0 ? (
          <p className="dashboard-section-empty">No {kind} entries in {periodRange.label}.</p>
        ) : (
          <div className="finance-entry-list">
            {periodEntries.map((entry) => (
              <article className="finance-entry-row" key={entry.id}>
                <div className="finance-entry-date">{formatDate(entry.entryDate, { year: "numeric" })}</div>
                <div className="finance-entry-details"><strong>{entry.category}</strong>{entry.description && <span>{entry.description}</span>}</div>
                <strong className="finance-entry-amount">{formatMoney(entry.amountCents)}</strong>
                <button className="account-delete-button" onClick={() => editEntry(entry)} type="button">Edit</button>
                <button className="account-delete-button" onClick={() => void removeEntry(entry)} type="button">Delete</button>
              </article>
            ))}
          </div>
        )}
      </section>
      {kind === "income" && (
        <section className="panel finance-list-panel">
          <div className="panel-heading"><div><h2>Recurring income</h2><p>Schedules are shown separately; only dated Income entries count in period results.</p></div></div>
          {loading ? <p className="mortgage-status">Loading recurring income…</p> : recurringItems.length === 0 ? (
            <p className="dashboard-section-empty">No recurring income schedules yet. Choose “This is recurring income” when adding regular pay or another expected payment.</p>
          ) : (
            <div className="finance-entry-list">{recurringItems.map((item) => (
              <article className="finance-entry-row" key={item.id}>
                <div className="finance-entry-date">{formatDate(item.nextDate, { year: "numeric" })}</div>
                <div className="finance-entry-details"><strong>{item.category}</strong><span>Expected {({ weekly: "weekly", fortnightly: "fortnightly", monthly: "monthly", quarterly: "quarterly", yearly: "yearly" })[item.recurrence]} · Next {formatDate(item.nextDate, { year: "numeric" })}{item.description ? ` · ${item.description}` : ""}</span></div>
                <strong className="finance-entry-amount">{formatMoney(item.amountCents)}</strong>
                <button className="account-delete-button" onClick={() => editRecurringIncome(item)} type="button">Edit</button>
                <button className="account-delete-button" onClick={() => void removeRecurringIncome(item)} type="button">Delete</button>
              </article>
            ))}</div>
          )}
        </section>
      )}
    </div>
  );
}

interface PlannerDraft {
  kind: "bill" | "insurance";
  name: string;
  provider: string;
  amount: string;
  dueDate: string;
  recurrence: Recurrence;
  paymentFrequency: InsurancePaymentFrequency;
  notes: string;
  propertyName: string;
  insuredAmount: string;
  contentsCoverAmount: string;
  policyType: InsuranceType;
  policyNumber: string;
  renewalDate: string;
  vehicle: string;
  coverBasis: string;
  policyLevel: string;
  coveredPeople: string;
  petName: string;
  coverLevel: string;
  tripDestination: string;
  coverageStartDate: string;
  coverageEndDate: string;
  insuredPerson: string;
  waitingPeriod: string;
  benefitPeriod: string;
  otherDescription: string;
}

function emptyPlannerDraft(kind: PlannerKind): PlannerDraft {
  return {
    kind, name: "", provider: "", amount: "", dueDate: todayInputDate(), recurrence: "none",
    paymentFrequency: "monthly", notes: "", propertyName: "", insuredAmount: "", contentsCoverAmount: "",
    policyType: "home", policyNumber: "", renewalDate: "", vehicle: "", coverBasis: "",
    policyLevel: "", coveredPeople: "", petName: "", coverLevel: "", tripDestination: "",
    coverageStartDate: "", coverageEndDate: "", insuredPerson: "", waitingPeriod: "",
    benefitPeriod: "", otherDescription: "",
  };
}

function PlannerPage({ kind, periodRange, onChanged }: { kind: PlannerKind; periodRange: PeriodRange; onChanged: () => Promise<void> }) {
  const [allItems, setItems] = useState<PlannerItem[]>([]);
  const [draft, setDraft] = useState<PlannerDraft>(() => emptyPlannerDraft(kind));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [billTab, setBillTab] = useState<"upcoming" | "paid">("upcoming");
  const [markingPaidId, setMarkingPaidId] = useState<number | null>(null);
  const [deletingAllBills, setDeletingAllBills] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pageTitle = kind === "bill" ? "Bills" : "Insurance";
  const title = kind === "bill" ? billTab === "upcoming" ? "Upcoming bills" : "Paid bills" : pageTitle;
  const selectedStatusItems = allItems.filter((item) => (item.status ?? "upcoming") === billTab);

  async function loadItems() {
    setItems(await api.plannerItems(kind));
  }

  useEffect(() => {
    loadItems()
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : `Unable to load ${title.toLowerCase()}.`))
      .finally(() => setLoading(false));
  }, [kind]);

  function resetForm() {
    setDraft(emptyPlannerDraft(kind));
    setEditingId(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    const payload: PlannerItemInput = {
      ...draft,
      amountCents: Math.round(Number(draft.amount) * 100),
      insuredValueCents: kind === "insurance" ? Math.round(Number(draft.insuredAmount) * 100) : 0,
      contentsCoverCents: kind === "insurance" ? Math.round(Number(draft.contentsCoverAmount) * 100) : 0,
      recurrence: kind === "insurance"
        ? draft.paymentFrequency === "one-off" ? "none" : draft.paymentFrequency === "half-yearly" ? "yearly" : draft.paymentFrequency
        : draft.recurrence,
      paymentFrequency: kind === "insurance" ? draft.paymentFrequency : undefined,
    };
    try {
      if (editingId === null) await api.createPlannerItem(payload);
      else await api.updatePlannerItem(editingId, payload);
      await loadItems();
      await onChanged();
      setMessage(`${pageTitle.slice(0, -1)} ${editingId === null ? "added" : "updated"}.`);
      resetForm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to save ${pageTitle.toLowerCase()}.`);
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(item: PlannerItem) {
    if (!window.confirm(`Delete “${item.name}”?`)) return;
    setError("");
    try {
      await api.deletePlannerItem(item.id);
      await loadItems();
      await onChanged();
      if (editingId === item.id) resetForm();
      setMessage(`${pageTitle.slice(0, -1)} deleted.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to delete ${pageTitle.toLowerCase()} item.`);
    }
  }

  async function markPaid(item: PlannerItem) {
    setError("");
    setMessage("");
    setMarkingPaidId(item.id);
    try {
      await api.markPlannerItemPaid(item.id);
      await loadItems();
      await onChanged();
      setMessage("Bill marked as paid.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to mark the bill as paid.");
    } finally {
      setMarkingPaidId(null);
    }
  }

  async function deleteAllBillsInTab() {
    if (kind !== "bill" || selectedStatusItems.length === 0) return;
    const singularLabel = billTab === "paid" ? "paid bill" : "upcoming bill";
    const pluralLabel = `${singularLabel}s`;
    const selectedLabel = selectedStatusItems.length === 1 ? singularLabel : pluralLabel;
    if (!window.confirm(`Delete all ${selectedStatusItems.length} ${selectedLabel}? This cannot be undone.`)) return;
    setError("");
    setMessage("");
    setDeletingAllBills(true);
    try {
      const { deleted } = await api.deletePlannerItemsByStatus(billTab);
      await loadItems();
      await onChanged();
      if (editingId !== null && selectedStatusItems.some((item) => item.id === editingId)) resetForm();
      setMessage(`${deleted} ${deleted === 1 ? singularLabel : pluralLabel} deleted.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to delete ${pluralLabel}.`);
    } finally {
      setDeletingAllBills(false);
    }
  }

  function editItem(item: PlannerItem) {
    setEditingId(item.id);
    setDraft({
      kind,
      name: item.name,
      provider: item.provider,
      amount: (item.amountCents / 100).toFixed(2),
      dueDate: item.status === "paid" ? item.dueDate : item.nextDueDate,
      recurrence: item.recurrence,
      paymentFrequency: item.paymentFrequency || (item.recurrence === "none" ? "one-off" : item.recurrence),
      notes: item.notes,
      propertyName: item.propertyName,
      insuredAmount: item.insuredValueCents ? (item.insuredValueCents / 100).toFixed(2) : "",
      contentsCoverAmount: item.contentsCoverCents ? (item.contentsCoverCents / 100).toFixed(2) : "",
      policyType: normalizeInsuranceType(item.policyType),
      policyNumber: item.policyNumber,
      renewalDate: item.renewalDate,
      vehicle: item.vehicle,
      coverBasis: item.coverBasis,
      policyLevel: item.policyLevel,
      coveredPeople: item.coveredPeople,
      petName: item.petName,
      coverLevel: item.coverLevel,
      tripDestination: item.tripDestination,
      coverageStartDate: item.coverageStartDate,
      coverageEndDate: item.coverageEndDate,
      insuredPerson: item.insuredPerson,
      waitingPeriod: item.waitingPeriod,
      benefitPeriod: item.benefitPeriod,
      otherDescription: item.otherDescription,
    });
  }

  function renderInsuranceField(field: InsuranceDetailField) {
    const textField = (
      label: string,
      key: keyof PlannerDraft,
      maxLength: number,
      required = false,
    ) => (
      <label key={field}>{label}<input maxLength={maxLength} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} required={required} value={String(draft[key])} /></label>
    );
    const moneyField = (label: string, key: "insuredAmount" | "contentsCoverAmount", required = false) => (
      <label key={field}>{label}<span className="money-input"><span>$</span><input inputMode="decimal" max="1000000000" min="0" onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} required={required} step="0.01" type="number" value={draft[key]} /></span></label>
    );
    const dateField = (label: string, key: "coverageStartDate" | "coverageEndDate") => (
      <label key={field}>{label}<input onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} type="date" value={draft[key]} /></label>
    );

    switch (field) {
      case "propertyName": return textField("Property or home", "propertyName", 80, draft.policyType === "home");
      case "buildingCover": return moneyField("Building cover amount (AUD)", "insuredAmount", draft.policyType === "home");
      case "contentsCover": return moneyField("Contents cover amount (AUD)", "contentsCoverAmount");
      case "vehicle": return textField("Vehicle", "vehicle", 100);
      case "coverBasis":
        return (
          <label key={field}>Cover basis<select onChange={(event) => setDraft((current) => ({ ...current, coverBasis: event.target.value }))} value={draft.coverBasis}>
            <option value="">Select cover basis</option><option value="agreed">Agreed value</option><option value="market">Market value</option>
          </select></label>
        );
      case "insuredValue":
        return moneyField(
          draft.policyType === "car" ? "Insured/agreed value (AUD)" : draft.policyType === "life" ? "Cover amount (AUD)" : "Insured value (AUD, optional)",
          "insuredAmount",
        );
      case "policyLevel": return textField("Policy or cover level", "policyLevel", 100);
      case "coveredPeople": return textField("Covered people or household", "coveredPeople", 200);
      case "petName": return textField("Pet name", "petName", 100);
      case "coverLevel": return textField("Cover level", "coverLevel", 100);
      case "tripDestination": return textField("Trip or destination", "tripDestination", 150);
      case "coverageStartDate": return dateField("Coverage start date", "coverageStartDate");
      case "coverageEndDate": return dateField("Coverage end date", "coverageEndDate");
      case "insuredPerson": return textField("Insured person", "insuredPerson", 100);
      case "monthlyBenefit": return moneyField("Monthly benefit (AUD)", "insuredAmount");
      case "waitingPeriod": return textField("Waiting period", "waitingPeriod", 80);
      case "benefitPeriod": return textField("Benefit period", "benefitPeriod", 80);
      case "description": return textField("Description", "otherDescription", 300);
    }
  }

  function getPolicyDetails(item: PlannerItem): Array<{ label: string; value: string }> {
    const type = normalizeInsuranceType(item.policyType);
    const values: Partial<Record<InsuranceDetailField, string>> = {
      propertyName: item.propertyName,
      buildingCover: item.insuredValueCents > 0 ? formatMoney(item.insuredValueCents) : "",
      contentsCover: item.contentsCoverCents > 0 ? formatMoney(item.contentsCoverCents) : "",
      vehicle: item.vehicle,
      coverBasis: item.coverBasis === "agreed" || item.coverBasis === "agreed value"
        ? "Agreed value"
        : item.coverBasis === "market" || item.coverBasis === "market value" ? "Market value" : "",
      insuredValue: item.insuredValueCents > 0 ? formatMoney(item.insuredValueCents) : "",
      policyLevel: item.policyLevel,
      coveredPeople: item.coveredPeople,
      petName: item.petName,
      coverLevel: item.coverLevel,
      tripDestination: item.tripDestination,
      coverageStartDate: item.coverageStartDate ? formatDate(item.coverageStartDate, { year: "numeric" }) : "",
      coverageEndDate: item.coverageEndDate ? formatDate(item.coverageEndDate, { year: "numeric" }) : "",
      insuredPerson: item.insuredPerson,
      monthlyBenefit: item.insuredValueCents > 0 ? formatMoney(item.insuredValueCents) : "",
      waitingPeriod: item.waitingPeriod,
      benefitPeriod: item.benefitPeriod,
      description: item.otherDescription,
    };
    const labels: Record<InsuranceDetailField, string> = {
      propertyName: "Property or home",
      buildingCover: "Building cover",
      contentsCover: "Contents cover",
      vehicle: "Vehicle",
      coverBasis: "Cover basis",
      insuredValue: type === "car" ? "Insured/agreed value" : type === "life" ? "Cover amount" : "Insured value",
      policyLevel: "Policy or cover level",
      coveredPeople: "Covered people",
      petName: "Pet",
      coverLevel: "Cover level",
      tripDestination: "Trip or destination",
      coverageStartDate: "Coverage start",
      coverageEndDate: "Coverage end",
      insuredPerson: "Insured person",
      monthlyBenefit: "Monthly benefit",
      waitingPeriod: "Waiting period",
      benefitPeriod: "Benefit period",
      description: "Description",
    };
    return INSURANCE_TYPE_FIELDS[type]
      .map((field) => ({ label: labels[field], value: values[field] ?? "" }))
      .filter(({ value }) => value !== "");
  }

  const today = todayInputDate();
  const upcomingItemsInPeriod = allItems.filter((item) =>
    item.kind === "bill" &&
    (item.status ?? "upcoming") === "upcoming" &&
    isPeriodCurrentOrFuture(periodRange, today) &&
    isDateInPeriod(item.nextDueDate, periodRange),
  );
  const items = kind === "bill"
    ? allItems
      .filter((item) => {
        if ((item.status ?? "upcoming") !== billTab) return false;
        const date = billTab === "paid" ? item.paidDate : item.nextDueDate;
        if (!date) return false;
        return billTab === "paid"
          ? isDateInPeriod(date, periodRange)
          : isPeriodCurrentOrFuture(periodRange, today) && isDateInPeriod(date, periodRange);
      })
      .sort((left, right) => billTab === "paid"
        ? (right.paidDate ?? right.dueDate).localeCompare(left.paidDate ?? left.dueDate)
        : left.nextDueDate.localeCompare(right.nextDueDate))
    : sortInsurancePolicies(allItems);
  const upcomingTotalCents = upcomingItemsInPeriod.reduce((total, item) => total + item.amountCents, 0);

  return (
    <div className="secondary-page">
      <div className="welcome-row"><div><div className="eyebrow">{kind === "insurance" ? "POLICY REGISTER" : "UPCOMING HOUSEHOLD COSTS"}</div><h1>{pageTitle}</h1><p className="welcome-subtitle">{kind === "insurance" ? "Keep policy details and renewal dates together." : `Track one-off or recurring ${pageTitle.toLowerCase()} and their next due dates.`}</p></div></div>
      {kind === "bill" && isPeriodCurrentOrFuture(periodRange) && <div className="finance-summary-strip"><span>Upcoming Bills · {periodRange.label}</span><strong>{formatMoney(upcomingTotalCents)}</strong><span>Planned only · excluded from actual outgoings</span></div>}
      <section className="panel finance-entry-panel">
        <div className="panel-heading"><div><h2>{editingId === null ? `Add ${kind === "bill" ? "bill" : "insurance policy"}` : `Edit ${kind === "bill" ? "bill" : "insurance policy"}`}</h2><p>{kind === "insurance" ? "Keep payment timing separate from the policy renewal date." : "Recurring items calculate the next due date from the date you enter."}</p></div></div>
        <form className="finance-entry-form" onSubmit={submit}>
          <label>{kind === "insurance" ? "Policy name" : "Name"}<input maxLength={100} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder={kind === "bill" ? "e.g. Electricity" : "e.g. Home insurance"} required value={draft.name} /></label>
          <label>{kind === "bill" ? "Provider (optional)" : "Insurer"}<input maxLength={100} onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value }))} required={kind === "insurance"} value={draft.provider} /></label>
          <label>{kind === "bill" ? "Amount (AUD)" : "Premium amount (AUD)"}<span className="money-input"><span>$</span><input inputMode="decimal" max="1000000000" min={kind === "insurance" ? "0" : "0.01"} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))} required step="0.01" type="number" value={draft.amount} /></span></label>
          {kind === "insurance" && <>
            <label>Type of insurance<select onChange={(event) => setDraft((current) => ({ ...current, policyType: event.target.value as InsuranceType }))} required value={draft.policyType}>
              {INSURANCE_TYPES.map((type) => <option key={type} value={type}>{INSURANCE_TYPE_LABELS[type]}</option>)}
            </select></label>
            <label>Policy number (optional)<input maxLength={100} onChange={(event) => setDraft((current) => ({ ...current, policyNumber: event.target.value }))} value={draft.policyNumber} /></label>
            {INSURANCE_TYPE_FIELDS[draft.policyType].map(renderInsuranceField)}
          </>}
          <label>{kind === "insurance" ? "Next payment date" : "Next due date"}<input onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value }))} required type="date" value={draft.dueDate} /></label>
          {kind === "insurance" ? <>
            <label>Payment frequency<select onChange={(event) => setDraft((current) => ({ ...current, paymentFrequency: event.target.value as InsurancePaymentFrequency }))} value={draft.paymentFrequency}>
              {Object.entries(INSURANCE_FREQUENCY_LABELS).map(([frequency, label]) => <option key={frequency} value={frequency}>{label}</option>)}
            </select></label>
            <label>Policy renewal date (recommended)<input onChange={(event) => setDraft((current) => ({ ...current, renewalDate: event.target.value }))} type="date" value={draft.renewalDate} /></label>
          </> : <label>Recurrence<select onChange={(event) => setDraft((current) => ({ ...current, recurrence: event.target.value as Recurrence }))} value={draft.recurrence}>
            <option value="none">One-off</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
          </select></label>}
          <label className="entry-description-field">Notes (optional)<input maxLength={300} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} value={draft.notes} /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          {message && <div className="mortgage-success" role="status">{message}</div>}
          <div className="finance-form-actions"><button className="primary-button" disabled={saving}>{saving ? "Saving…" : editingId === null ? `Add ${kind === "bill" ? "bill" : "policy"}` : "Update item"} <ArrowRight size={15} /></button>{editingId !== null && <button className="secondary-button" onClick={resetForm} type="button">Cancel edit</button>}</div>
        </form>
      </section>
      <section className="panel finance-list-panel">
        <div className="panel-heading"><div><h2>{kind === "bill" ? "Bills" : "Policies and renewals"}</h2><p>{kind === "bill" ? "Track upcoming bills and payments already made." : "All active policies, ordered by renewal date."}</p></div></div>
        {kind === "bill" && (
        <div className="bill-status-controls">
          <div aria-label="Bill status" className="bill-status-tabs" role="tablist">
            <button aria-selected={billTab === "upcoming"} className={billTab === "upcoming" ? "selected" : ""} onClick={() => setBillTab("upcoming")} role="tab" type="button">Upcoming</button>
            <button aria-selected={billTab === "paid"} className={billTab === "paid" ? "selected" : ""} onClick={() => setBillTab("paid")} role="tab" type="button">Paid</button>
          </div>
          <button className="account-delete-button bill-delete-all-button" disabled={loading || deletingAllBills || selectedStatusItems.length === 0} onClick={() => void deleteAllBillsInTab()} type="button">
            {deletingAllBills ? "Deleting…" : "Delete all"}
          </button>
          </div>
        )}
        {loading ? <p className="mortgage-status">Loading {title.toLowerCase()}…</p> : items.length === 0 ? <p className="dashboard-section-empty">{kind === "insurance" ? "No insurance policies added yet." : `No ${title.toLowerCase()} in ${periodRange.label}.`}</p> : (
          <div className="finance-entry-list">{items.map((item) => (
            <article className={`finance-entry-row${kind === "insurance" && getPolicyRenewalStatus(item.renewalDate) ? ` insurance-renewal-${getPolicyRenewalStatus(item.renewalDate)}` : ""}`} key={item.id}>
              <div className="finance-entry-date">{formatDate(kind === "bill" && billTab === "paid" ? item.paidDate ?? item.dueDate : item.nextDueDate, { year: "numeric" })}</div>
                <div className="finance-entry-details"><strong>{item.name}</strong>
                  {kind === "insurance" ? <>
                    <span>{getInsuranceTypeLabel(item.policyType)} · {item.provider}{item.policyNumber ? ` · Policy ${item.policyNumber}` : ""}</span>
                    <span><b>Premium:</b> {formatMoney(item.amountCents)} · {INSURANCE_FREQUENCY_LABELS[(item.paymentFrequency || (item.recurrence === "none" ? "one-off" : item.recurrence)) as InsurancePaymentFrequency] ?? (item.paymentFrequency || item.recurrence)}</span>
                    <span><b>Next payment:</b> {formatDate(item.nextDueDate, { year: "numeric" })}</span>
                    <span><b>Policy renewal:</b> {item.renewalDate ? formatDate(item.renewalDate, { year: "numeric" }) : "Not set"}</span>
                    {getPolicyRenewalStatus(item.renewalDate) && <span className="insurance-renewal-warning">{getPolicyRenewalStatus(item.renewalDate) === "overdue" ? "Renewal overdue" : "Renewal within 30 days"}</span>}
                    {getPolicyDetails(item).map(({ label, value }) => <span key={label}><b>{label}:</b> {value}</span>)}
                    {item.notes && <span>Notes: {item.notes}</span>}
                  </> : <span>{[item.provider, item.recurrence === "none" ? "One-off" : ({ weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly", none: "One-off" }[item.recurrence])].filter(Boolean).join(" · ")}{item.notes ? ` · ${item.notes}` : ""}</span>}
                </div>
              <strong className="finance-entry-amount">{formatMoney(item.amountCents)}{kind === "insurance" && <small className="entry-amount-label">premium</small>}</strong>
              {kind === "bill" && (item.status ?? "upcoming") === "paid" && <span className="bill-paid-status">Paid</span>}
              {kind === "bill" && (item.status ?? "upcoming") === "upcoming" && <button className="secondary-button bill-mark-paid-button" disabled={markingPaidId === item.id} onClick={() => void markPaid(item)} type="button">{markingPaidId === item.id ? "Saving…" : "Mark paid"}</button>}
              <button className="account-delete-button" onClick={() => editItem(item)} type="button">Edit</button>
              <button className="account-delete-button" onClick={() => void removeItem(item)} type="button">Delete</button>
            </article>
          ))}</div>
        )}
      </section>
    </div>
  );
}

interface BudgetDraft {
  group: BudgetGroup;
  category: string;
  limit: string;
  frequency: BudgetFrequency;
  sourceType: BudgetSourceType;
  sourceId: string;
}

interface BudgetSourceOption {
  id: number;
  name: string;
  detail: string;
}

function BudgetsPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const [budgets, setBudgets] = useState<BudgetPlan[]>([]);
  const [drafts, setDrafts] = useState<BudgetDraft[]>([]);
  const [summary, setSummary] = useState<BudgetBuilderSummary | null>(null);
  const [sources, setSources] = useState<Record<BudgetSourceType, BudgetSourceOption[]>>({
    mortgage: [], loan: [], bill: [], insurance: [], other: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([
      api.budgets(),
      api.budgetBuilderSummary(),
      api.mortgage(),
      api.loans(),
      api.plannerItems("bill"),
      api.plannerItems("insurance"),
    ])
      .then(([loaded, loadedSummary, mortgages, loans, bills, insurance]) => {
        setBudgets(loaded);
        setSummary(loadedSummary);
        setDrafts(loaded.map((budget) => ({
          group: budget.group,
          category: budget.category,
          limit: (budget.limitCents / 100).toFixed(2),
          frequency: budget.frequency,
          sourceType: budget.sourceType,
          sourceId: budget.sourceId === null ? "" : String(budget.sourceId),
        })));
        setSources({
          mortgage: mortgages.map((mortgage) => ({
            id: mortgage.id,
            name: mortgage.name,
            detail: mortgage.repaymentCents === null
              ? "Repayment not set"
              : `${formatMoney(mortgage.repaymentCents)} ${mortgage.repaymentFrequency}`,
          })),
          loan: loans.map((loan) => ({
            id: loan.id,
            name: loan.name,
            detail: loan.repaymentCents === null
              ? "Repayment not set"
              : `${formatMoney(loan.repaymentCents)} ${loan.repaymentFrequency}`,
          })),
          bill: bills.filter((bill) => bill.status === "upcoming").map((bill) => ({
            id: bill.id,
            name: bill.name,
            detail: `${formatMoney(bill.amountCents)} ${bill.recurrence === "none" ? "one-off" : bill.recurrence}`,
          })),
          insurance: insurance.filter((policy) => policy.status === "upcoming").map((policy) => ({
            id: policy.id,
            name: policy.name,
            detail: `${formatMoney(policy.amountCents)} premium ${policy.recurrence === "none" ? "one-off" : policy.recurrence}`,
          })),
          other: [],
        });
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load budgets."))
      .finally(() => setLoading(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const saved = await api.saveBudgets(drafts.map((budget) => ({
        category: budget.category,
        group: budget.group,
        limitCents: Math.round(Number(budget.limit) * 100),
        frequency: budget.frequency,
        sourceType: budget.sourceType,
        sourceId: budget.sourceType === "other" ? null : Number(budget.sourceId),
      })));
      setBudgets(saved);
      setDrafts(saved.map((budget) => ({
        group: budget.group,
        category: budget.category,
        limit: (budget.limitCents / 100).toFixed(2),
        frequency: budget.frequency,
        sourceType: budget.sourceType,
        sourceId: budget.sourceId === null ? "" : String(budget.sourceId),
      })));
      setSummary(await api.budgetBuilderSummary());
      await onChanged();
      setMessage("Budgets saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save budgets.");
    } finally {
      setSaving(false);
    }
  }

  const cadenceLabel: Record<BudgetFrequency, string> = {
    weekly: "Weekly",
    fortnightly: "Fortnightly",
    monthly: "Monthly",
  };
  const allocationDrafts = drafts.map((budget) => ({
    limitCents: Math.max(0, Math.round(Number(budget.limit) * 100) || 0),
    frequency: budget.frequency,
    sourceType: budget.sourceType,
  }));
  const allocatedCents = calculateBudgetAllocations(allocationDrafts);
  const totals = calculateBudgetSummary(
    summary?.incomeCents ?? 0,
    summary?.fixedCommitmentsCents ?? 0,
    allocatedCents,
  );
  const luxuryAllocatedCents = drafts
    .filter((budget) => budget.group === "Luxury")
    .reduce((total, budget) => total + monthlyEquivalentCents(Math.max(0, Math.round(Number(budget.limit) * 100) || 0), budget.frequency), 0);
  const savingsWarning = getSavingsGoalWarning(
    drafts.map((budget) => {
      const saved = budgets.find((item) => item.category.toLocaleLowerCase() === budget.category.trim().toLocaleLowerCase());
      return {
        group: budget.group,
        limitCents: Math.max(0, Math.round(Number(budget.limit) * 100) || 0),
        spentCents: saved?.spentCents ?? 0,
        frequency: budget.frequency,
      };
    }),
    luxuryAllocatedCents,
  );
  const sourceTypeLabel: Record<BudgetSourceType, string> = {
    mortgage: "Mortgage",
    loan: "Loan",
    bill: "Bill",
    insurance: "Insurance",
    other: "Other",
  };

  function updateDraft(index: number, change: Partial<BudgetDraft>) {
    setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));
  }

  const orderedBudgets = BUDGET_GROUPS.map((group) => ({
    group,
    items: budgets.filter((budget) => budget.group === group),
  }));
  const orderedDrafts = drafts
    .map((budget, index) => ({ budget, index }))
    .sort((left, right) => BUDGET_GROUPS.indexOf(left.budget.group) - BUDGET_GROUPS.indexOf(right.budget.group));
  const percent = (spent: number, limit: number) => Math.round(spent / limit * 100);

  return (
    <div className="secondary-page">
      <div className="welcome-row"><div><div className="eyebrow">HOUSEHOLD SPENDING PLAN</div><h1>Budget Builder</h1><p className="welcome-subtitle">Understand what is available, then allocate it across your priorities.</p></div></div>
      <section className="budget-builder-summary" aria-label="Monthly budget summary">
        {[
          ["Income", summary?.incomeCents ?? 0, `Recorded in ${summary?.month ?? "this month"}`],
          ["Fixed commitments", summary?.fixedCommitmentsCents ?? 0, "Monthly equivalent"],
          ["Available to budget", totals.availableCents, "Income less fixed commitments"],
          ["Budget allocated", allocatedCents, "Excludes linked fixed commitments"],
          ["Remaining", totals.remainingCents, totals.overBudgetCents > 0 ? `Over budget by ${formatMoney(totals.overBudgetCents)}` : "Still available to allocate"],
        ].map(([label, amount, detail]) => (
          <div className="budget-summary-card" key={label as string}>
            <span>{label}</span><strong className={label === "Remaining" && totals.overBudgetCents > 0 ? "budget-negative" : ""}>{formatMoney(amount as number)}</strong><small>{detail}</small>
          </div>
        ))}
      </section>
      {totals.overBudgetCents > 0 && <p className="budget-over-warning" role="status">Your plan is over the available amount by {formatMoney(totals.overBudgetCents)}. You can still save this budget.</p>}
      {savingsWarning && (
        <aside className="budget-guidance" role="status">
          <strong>Savings goal not fully funded</strong>
          <span>{formatMoney(savingsWarning.remainingTargetCents)} remains to reach your savings target while {formatMoney(savingsWarning.luxuryAllocatedCents)} is allocated to Luxury.</span>
        </aside>
      )}
      <section className="panel finance-list-panel">
        <div className="panel-heading"><div><h2>Spending compared with budget</h2><p>Recorded spending is compared with each saved budget amount. Linked fixed commitments are shown separately.</p></div></div>
        {loading ? <p className="mortgage-status">Loading budgets…</p> : budgets.length === 0 ? <p className="dashboard-section-empty">No budgets yet. Add categories and monthly limits below.</p> : (
          <div className="budget-priority-list">{orderedBudgets.filter(({ items }) => items.length > 0).map(({ group, items }) => (
            <section className={`budget-priority-group budget-group-${BUDGET_GROUPS.indexOf(group)}`} key={group}>
              <h3>{group}</h3>
              <div className="budget-list">{items.map((budget) => {
                const totalUsed = budget.spentCents + budget.committedCents;
                const percentage = percent(totalUsed, budget.limitCents);
                const remaining = budget.limitCents - totalUsed;
                return <div className="budget-row" key={budget.id}>
                  <div className="budget-topline"><strong>{budget.category} · {cadenceLabel[budget.frequency]}</strong><span>{formatMoney(budget.spentCents)} actual · {percentage}% used</span></div>
                  <div className="budget-comparison"><span>Budget <b>{formatMoney(budget.limitCents)}</b></span><span>Actual spending <b>{formatMoney(budget.spentCents)}</b></span><span>Remaining <b>{formatMoney(remaining)}</b></span></div>
                  {budget.committedCents > 0 && <small className="budget-commitment">{formatMoney(budget.committedCents)} planned from linked fixed commitment</small>}
                  <div className="budget-track"><span className={percentage >= 95 ? "near-limit" : ""} style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }} /></div>
                </div>;
              })}</div>
            </section>
          ))}</div>
        )}
      </section>
      <section className="panel finance-entry-panel">
        <div className="accounts-form-heading"><div><h2>Allocate your budget</h2><p>Set a target for each category. Link a fixed commitment where it applies.</p></div><button className="secondary-button add-split-button" onClick={() => setDrafts((current) => [...current, { group: "Essentials", category: "", limit: "", frequency: "monthly", sourceType: "other", sourceId: "" }])} type="button">+ Add category</button></div>
        {loading ? <p className="mortgage-status">Loading…</p> : (
          <form className="budget-edit-form" onSubmit={submit}>
            {orderedDrafts.map(({ budget, index }, draftIndex) => {
              const options = sources[budget.sourceType];
              const previous = orderedDrafts[draftIndex - 1];
              return <Fragment key={index}>
                {(!previous || previous.budget.group !== budget.group) && <h3 className="budget-edit-group-title">{budget.group}</h3>}
                <div className={`budget-edit-row budget-group-${BUDGET_GROUPS.indexOf(budget.group)}`}>
                <label>Priority group<select onChange={(event) => updateDraft(index, { group: event.target.value as BudgetGroup, category: "" })} value={budget.group}>
                  {BUDGET_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
                </select></label>
                {budget.group === "Other" ? (
                  <label>Custom category<input maxLength={80} onChange={(event) => updateDraft(index, { category: event.target.value })} placeholder="Enter a category name" required value={budget.category} /></label>
                ) : (
                  <label>Category<select onChange={(event) => updateDraft(index, { category: event.target.value })} required value={budget.category}>
                    <option value="">Choose a category</option>
                    {BUDGET_CATEGORIES[budget.group].map((category) => <option key={category} value={category}>{category}</option>)}
                  </select></label>
                )}
                <label>Fixed commitment<select onChange={(event) => updateDraft(index, { sourceType: event.target.value as BudgetSourceType, sourceId: "" })} value={budget.sourceType}>
                  {Object.entries(sourceTypeLabel).map(([value, label]) => <option key={value} value={value}>{value === "other" ? "None" : label}</option>)}
                </select></label>
                {budget.sourceType !== "other" && <label>{sourceTypeLabel[budget.sourceType]} item<select onChange={(event) => updateDraft(index, { sourceId: event.target.value })} required value={budget.sourceId}>
                  <option value="">Choose an item</option>
                  {options.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.detail}</option>)}
                </select></label>}
                <label>Budget period<select onChange={(event) => updateDraft(index, { frequency: event.target.value as BudgetFrequency })} value={budget.frequency}>
                  <option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option>
                </select></label>
                <label>{cadenceLabel[budget.frequency]} limit (AUD)<span className="money-input"><span>$</span><input inputMode="decimal" min="0.01" onChange={(event) => updateDraft(index, { limit: event.target.value })} required step="0.01" type="number" value={budget.limit} /></span></label>
                <button className="account-delete-button" onClick={() => setDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">Remove</button>
                </div>
              </Fragment>;
            })}
            {error && <div className="form-error" role="alert">{error}</div>}
            {message && <div className="mortgage-success" role="status">{message}</div>}
            <p className="budget-allocation-note">Linked fixed commitments are already included above and are not deducted again from your category allocations.</p>
            <div className="finance-form-actions"><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save budget plan"} <ArrowRight size={15} /></button></div>
          </form>
        )}
      </section>
    </div>
  );
}

function ReportsPage({
  periodRange,
  report,
  loading,
  error,
}: {
  periodRange: PeriodRange;
  report: FinanceReport | null;
  loading: boolean;
  error: string;
}) {
  return (
    <div className="secondary-page">
      <div className="welcome-row"><div><div className="eyebrow">YOUR FINANCIAL ACTIVITY</div><h1>Reports</h1><p className="welcome-subtitle">Actual financial results for {periodRange.label}.</p></div></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {loading ? <section className="panel finance-list-panel"><p className="mortgage-status">Loading reports…</p></section> : !report ? (
        <section className="panel finance-list-panel"><p className="dashboard-section-empty">Period report data is unavailable.</p></section>
      ) : (
        <>
          <div className="finance-summary-strip">
            <span>Income<strong>{formatMoney(report.incomeCents)}</strong></span>
            <span>Spending<strong>{formatMoney(report.spendingCents)}</strong></span>
            <span>Bills paid<strong>{formatMoney(report.billsPaidCents)}</strong></span>
            <span>Total outgoings<strong>{formatMoney(report.totalOutgoingsCents)}</strong></span>
            <span>Net cash flow<strong>{formatMoney(report.netCashFlowCents)}</strong></span>
            {isPeriodCurrentOrFuture(periodRange) && <span>Upcoming Bills<strong>{formatMoney(report.upcomingBillsCents)}</strong></span>}
          </div>
          <section className="panel report-chart-panel">
            <div className="panel-heading"><div><h2>Cash flow</h2><p>Income, Spending and Bills paid by actual date in {periodRange.label}.</p></div></div>
            {report.hasActivity ? (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={report.series} margin={{ top: 12, right: 5, bottom: 0, left: -12 }}>
                      <defs><linearGradient id="reportIncome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5d87e8" stopOpacity={0.2} /><stop offset="100%" stopColor="#5d87e8" stopOpacity={0} /></linearGradient><linearGradient id="reportSpending" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c4b5fd" stopOpacity={0.25} /><stop offset="100%" stopColor="#c4b5fd" stopOpacity={0} /></linearGradient><linearGradient id="reportBills" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f1b85a" stopOpacity={0.2} /><stop offset="100%" stopColor="#f1b85a" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid stroke="#edf0f4" vertical={false} />
                      <XAxis dataKey="bucket" tickFormatter={(bucket: string) => formatPeriodBucket(bucket, periodRange.unit)} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(value: number) => `$${(value / 100000).toFixed(1)}k`} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip periodUnit={periodRange.unit} />} />
                      <Area type="monotone" dataKey="incomeCents" name="Income" stroke="#5d87e8" strokeWidth={2.5} fill="url(#reportIncome)" />
                      <Area type="monotone" dataKey="spendingCents" name="Spending" stroke="#a78bfa" strokeWidth={2.5} fill="url(#reportSpending)" />
                      <Area type="monotone" dataKey="billsPaidCents" name="Bills paid" stroke="#e1a843" strokeWidth={2.5} fill="url(#reportBills)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
            ) : <div className="dashboard-section-empty">No income, spending or paid bills in this period.</div>}
          </section>
          <section className="panel finance-list-panel">
            <div className="panel-heading"><div><h2>Outgoings by category</h2><p>Spending entries plus Bills paid in {periodRange.label}.</p></div></div>
            {report.categories.length === 0 ? <p className="dashboard-section-empty">No outgoings recorded in this period.</p> : report.categories.map((category) => (
              <div className="budget-topline report-category-row" key={category.category}><strong>{category.category}</strong><span>{formatMoney(category.spendingCents)}</span></div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

interface LoanDraft {
  name: string;
  lender: string;
  type: LoanType;
  balance: string;
  interestRate: string;
  repayment: string;
  repaymentFrequency: "weekly" | "fortnightly" | "monthly";
}

function newLoan(index: number): LoanDraft {
  return {
    name: `Loan ${index + 1}`,
    lender: "",
    type: "personal",
    balance: "",
    interestRate: "",
    repayment: "",
    repaymentFrequency: "monthly",
  };
}

function LoansPage({ onSaved }: { onSaved: () => Promise<void> }) {
  const [loans, setLoans] = useState<LoanDraft[]>([]);
  const [savedLoans, setSavedLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.loans()
      .then((loaded) => {
        setSavedLoans(loaded);
        setLoans(loaded.map((loan) => ({
          name: loan.name,
          lender: loan.lender,
          type: loan.type,
          balance: (loan.balanceCents / 100).toFixed(2),
          interestRate: loan.interestRateBps === null ? "" : (loan.interestRateBps / 100).toFixed(2),
          repayment: loan.repaymentCents === null ? "" : (loan.repaymentCents / 100).toFixed(2),
          repaymentFrequency: loan.repaymentFrequency,
        })));
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Unable to load your loans.");
      })
      .finally(() => setLoading(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const saved = await api.saveLoans(loans.map((loan) => ({
        name: loan.name,
        lender: loan.lender,
        type: loan.type,
        balanceCents: Math.round(Number(loan.balance) * 100),
        interestRateBps: loan.interestRate === "" ? null : Math.round(Number(loan.interestRate) * 100),
        repaymentCents: loan.repayment === "" ? null : Math.round(Number(loan.repayment) * 100),
        repaymentFrequency: loan.repaymentFrequency,
      })));
      setSavedLoans(saved);
      await onSaved();
      setMessage("Your loan details have been saved on this device.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save your loans.");
    } finally {
      setSaving(false);
    }
  }

  function updateLoan(index: number, update: Partial<LoanDraft>) {
    setLoans((current) => current.map((loan, loanIndex) => loanIndex === index ? { ...loan, ...update } : loan));
  }

  return (
    <div className="secondary-page">
      <div className="welcome-row">
        <div>
          <div className="eyebrow">OTHER HOUSEHOLD LOANS</div>
          <h1>Loans</h1>
          <p className="welcome-subtitle">Track personal, car, student, and other loan balances separately from your mortgage.</p>
        </div>
      </div>
      <section className="panel mortgage-panel loans-panel">
        {loading ? <p className="mortgage-status">Loading saved loans…</p> : loans.length === 0 && savedLoans.length === 0 ? (
          <div className="loans-empty">
            <span className="loans-empty-icon"><Coins size={21} /></span>
            <div><h2>No other loans added</h2><p>Your home loan stays in Mortgage. Add another loan here whenever you need to track it.</p></div>
            <button className="primary-button" onClick={() => setLoans([newLoan(0)])} type="button">Add a loan <ArrowRight size={15} /></button>
          </div>
        ) : (
          <form className="loans-form" onSubmit={submit}>
            {loans.length === 0 && <p className="loans-empty-inline">No loans listed. Add one, or save to remove all loans.</p>}
            {loans.map((loan, index) => (
              <fieldset className="loan-card" key={index}>
                <legend>{loan.name || `Loan ${index + 1}`}</legend>
                <button className="remove-split-button" onClick={() => setLoans((current) => current.filter((_, loanIndex) => loanIndex !== index))} type="button">Remove</button>
                <label>Loan name<input maxLength={80} onChange={(event) => updateLoan(index, { name: event.target.value })} required value={loan.name} /></label>
                <label>Lender<input maxLength={80} onChange={(event) => updateLoan(index, { lender: event.target.value })} placeholder="Optional" value={loan.lender} /></label>
                <label>Loan type<select onChange={(event) => updateLoan(index, { type: event.target.value as LoanType })} value={loan.type}><option value="personal">Personal</option><option value="car">Car</option><option value="student">Student</option><option value="other">Other</option></select></label>
                <label>Current balance (AUD)<span className="money-input"><span>$</span><input inputMode="decimal" max="100000000" min="0.01" onChange={(event) => updateLoan(index, { balance: event.target.value })} required step="0.01" type="number" value={loan.balance} /></span></label>
                <label>Interest rate (optional)<span className="suffix-input"><input inputMode="decimal" max="100" min="0" onChange={(event) => updateLoan(index, { interestRate: event.target.value })} placeholder="e.g. 8.50" step="0.01" type="number" value={loan.interestRate} /><span>% p.a.</span></span></label>
                <label>Repayment (optional)<span className="money-input"><span>$</span><input inputMode="decimal" min="0" onChange={(event) => updateLoan(index, { repayment: event.target.value })} placeholder="e.g. 450" step="0.01" type="number" value={loan.repayment} /></span></label>
                <label>Repayment frequency<select onChange={(event) => updateLoan(index, { repaymentFrequency: event.target.value as LoanDraft["repaymentFrequency"] })} value={loan.repaymentFrequency}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option></select></label>
              </fieldset>
            ))}
            <button className="secondary-button add-split-button" onClick={() => setLoans((current) => [...current, newLoan(current.length)])} type="button">+ Add another loan</button>
            <div className="mortgage-total"><span>Total other loan balance</span><strong>{formatMoney(loans.reduce((total, loan) => total + (Number(loan.balance) || 0) * 100, 0))}</strong></div>
            {error && <div className="form-error" role="alert">{error}</div>}
            {message && <div className="mortgage-success" role="status">{message}</div>}
            <div className="mortgage-actions"><button className="primary-button" disabled={saving} type="submit">{saving ? "Saving…" : savedLoans.length ? "Update loans" : "Save loans"} <ArrowRight size={15} /></button></div>
          </form>
        )}
      </section>
    </div>
  );
}

interface MortgageSplitDraft {
  group: number;
  name: string;
  propertyName: string;
  propertyValue: string;
  balance: string;
  interestRate: string;
  repayment: string;
  rateType: "variable" | "fixed";
  fixedRateEndDate: string;
  repaymentFrequency: "weekly" | "fortnightly" | "monthly";
}

function newMortgageSplit(index: number, group = 0, propertyName = "Home", propertyValue = ""): MortgageSplitDraft {
  return {
    group,
    name: `Loan split ${index + 1}`,
    propertyName,
    propertyValue,
    balance: "",
    interestRate: "",
    repayment: "",
    rateType: "variable",
    fixedRateEndDate: "",
    repaymentFrequency: "monthly",
  };
}

function MortgagePage({ onSaved }: { onSaved: (mortgages: MortgageSplit[]) => void }) {
  const [loans, setLoans] = useState<MortgageSplitDraft[]>([]);
  const [savedMortgages, setSavedMortgages] = useState<MortgageSplit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.mortgage()
      .then((mortgages) => {
        setSavedMortgages(mortgages);
        const groupIds = new Map<string, number>();
        setLoans(mortgages.length
          ? mortgages.map((mortgage) => {
            const key = mortgage.propertyName.trim().toLocaleLowerCase();
            if (!groupIds.has(key)) groupIds.set(key, groupIds.size);
            return {
              group: groupIds.get(key) ?? 0,
              name: mortgage.name,
              propertyName: mortgage.propertyName,
              propertyValue: mortgage.propertyValueCents ? (mortgage.propertyValueCents / 100).toFixed(2) : "",
              balance: (mortgage.balanceCents / 100).toFixed(2),
              interestRate: mortgage.interestRateBps === null ? "" : (mortgage.interestRateBps / 100).toFixed(2),
              repayment: mortgage.repaymentCents === null ? "" : (mortgage.repaymentCents / 100).toFixed(2),
              rateType: mortgage.rateType,
              fixedRateEndDate: mortgage.fixedRateEndDate,
              repaymentFrequency: mortgage.repaymentFrequency,
            };
          }).sort((a, b) => a.group - b.group)
          : [newMortgageSplit(0)]);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Unable to load your mortgage details.");
      })
      .finally(() => setLoading(false));
  }, []);

  function addSplit(group: number) {
    setLoans((current) => {
      const members = current.filter((item) => item.group === group);
      const last = current.lastIndexOf(members[members.length - 1]);
      const added = newMortgageSplit(members.length, group, members[0].propertyName, members[0].propertyValue);
      return [...current.slice(0, last + 1), added, ...current.slice(last + 1)];
    });
  }

  function addMortgage() {
    setLoans((current) => {
      const group = Math.max(...current.map((item) => item.group)) + 1;
      return [...current, newMortgageSplit(0, group, "", "")];
    });
  }

  function patchGroup(group: number, change: Partial<MortgageSplitDraft>) {
    setLoans((current) => current.map((item) => item.group === group ? { ...item, ...change } : item));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const mortgages = await api.saveMortgage(loans.map((loan) => ({
        name: loan.name,
        propertyName: loan.propertyName,
        propertyValueCents: Math.round(Number(loan.propertyValue) * 100),
        balanceCents: Math.round(Number(loan.balance) * 100),
        interestRateBps: loan.interestRate === "" ? null : Math.round(Number(loan.interestRate) * 100),
        repaymentCents: loan.repayment === "" ? null : Math.round(Number(loan.repayment) * 100),
        rateType: loan.rateType,
        fixedRateEndDate: loan.rateType === "fixed" ? loan.fixedRateEndDate : "",
        repaymentFrequency: loan.repaymentFrequency,
      })));
      setSavedMortgages(mortgages);
      setMessage("Your ME home-loan splits have been saved on this device.");
      onSaved(mortgages);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save your mortgage details.");
    } finally {
      setSaving(false);
    }
  }

  const hasMortgageData = savedMortgages.length > 0 || loans.length > 1 || loans.some((loan, index) => (
    loan.group !== 0 ||
    (loan.name.trim() !== "" && loan.name.trim() !== `Loan split ${index + 1}`) ||
    (loan.propertyName.trim() !== "" && loan.propertyName.trim() !== "Home") ||
    loan.propertyValue.trim() !== "" ||
    loan.balance.trim() !== "" ||
    loan.interestRate.trim() !== "" ||
    loan.repayment.trim() !== "" ||
    loan.rateType !== "variable" ||
    loan.fixedRateEndDate.trim() !== "" ||
    loan.repaymentFrequency !== "monthly"
  ));

  return (
    <div className="secondary-page">
      <div className="welcome-row">
        <div>
          <div className="eyebrow">YOUR HOME LOAN</div>
          <h1>Mortgage</h1>
          <p className="welcome-subtitle">Keep your home-loan splits and property values up to date.</p>
        </div>
      </div>
      <section className="panel mortgage-panel">
        <div className="mortgage-notice">
          <LockKeyhole size={17} />
          <p><strong>Manual entry only</strong><span>Add a mortgage for each property, then a loan split for each part of that loan. Splits keep their own balance, rate and repayments, and the property name and value are shared by all splits on that mortgage. Reuse the property name for its insurance policy.</span></p>
        </div>
        {loading ? <p className="mortgage-status">Loading saved loan details…</p> : (
          <form className="mortgage-form" onSubmit={submit}>
            {loans.map((loan, index) => {
              const firstInGroup = loans.findIndex((item) => item.group === loan.group) === index;
              const lastInGroup = !loans.slice(index + 1).some((item) => item.group === loan.group);
              const splitNumber = loans.slice(0, index).filter((item) => item.group === loan.group).length + 1;
              return (
              <Fragment key={index}>
              {firstInGroup && (
                <div className="mortgage-property">
                  <h3>Mortgage {new Set(loans.slice(0, index + 1).map((item) => item.group)).size}</h3>
                  <label>
                    Property or home
                    <input maxLength={80} onChange={(event) => patchGroup(loan.group, { propertyName: event.target.value })} placeholder="e.g. 12 Smith Street" required value={loan.propertyName} />
                  </label>
                  <label>
                    Property value (AUD)
                    <span className="money-input"><span>$</span><input inputMode="decimal" max="1000000000" min="0" onChange={(event) => patchGroup(loan.group, { propertyValue: event.target.value })} placeholder="Current property value" required step="0.01" type="number" value={loan.propertyValue} /></span>
                  </label>
                </div>
              )}
              <fieldset className="mortgage-split">
                <legend>Loan split {splitNumber}</legend>
                <button className="remove-split-button" disabled={loans.length === 1} onClick={() => setLoans((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">Remove</button>
                <label>
                  Split name
                  <input maxLength={80} onChange={(event) => setLoans((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} required value={loan.name} />
                </label>
                <label>
                  Loan balance (AUD)
                  <span className="money-input"><span>$</span><input inputMode="decimal" max="100000000" min="-100000000" onChange={(event) => setLoans((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, balance: event.target.value } : item))} required step="0.01" type="number" value={loan.balance} /></span>
                </label>
                <label>
                  Interest rate (optional)
                  <span className="suffix-input"><input inputMode="decimal" max="100" min="0" onChange={(event) => setLoans((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, interestRate: event.target.value } : item))} placeholder="e.g. 6.15" step="0.01" type="number" value={loan.interestRate} /><span>% p.a.</span></span>
                </label>
                <div aria-label="Interest rate type" className="rate-type-control" role="group">
                  <button aria-pressed={loan.rateType === "variable"} onClick={() => setLoans((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, rateType: "variable" } : item))} type="button">Variable</button>
                  <button aria-pressed={loan.rateType === "fixed"} onClick={() => setLoans((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, rateType: "fixed" } : item))} type="button">Fixed</button>
                </div>
                {loan.rateType === "fixed" && (
                  <label>
                    Fixed rate ends on
                    <input onChange={(event) => setLoans((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, fixedRateEndDate: event.target.value } : item))} required type="date" value={loan.fixedRateEndDate} />
                  </label>
                )}
                <label>
                  Repayment amount (optional)
                  <span className="money-input"><span>$</span><input inputMode="decimal" min="0" onChange={(event) => setLoans((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, repayment: event.target.value } : item))} placeholder="e.g. 2,500" step="0.01" type="number" value={loan.repayment} /></span>
                </label>
                <label>
                  Repayment frequency
                  <select onChange={(event) => setLoans((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, repaymentFrequency: event.target.value as MortgageSplitDraft["repaymentFrequency"] } : item))} value={loan.repaymentFrequency}>
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
              </fieldset>
              {lastInGroup && <button className="secondary-button add-split-button" onClick={() => addSplit(loan.group)} type="button">+ Add another loan split to this mortgage</button>}
              </Fragment>
              );
            })}
            <button className="secondary-button add-split-button" onClick={addMortgage} type="button">+ Add another mortgage (different property)</button>
            <div className="mortgage-total"><span>Total loan balance</span><strong>{formatMoney(loans.reduce((total, loan) => total + (Number(loan.balance) || 0) * 100, 0))}</strong></div>
            {error && <div className="form-error" role="alert">{error}</div>}
            {message && <div className="mortgage-success" role="status">{message}</div>}
            {hasMortgageData && (
              <div className="mortgage-actions">
                <button className="primary-button" disabled={saving} type="submit">{saving ? "Saving…" : savedMortgages.length ? "Update loan splits" : "Save loan splits"} <ArrowRight size={15} /></button>
                {savedMortgages.length > 0 && <span>Last updated {new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(savedMortgages[0].updatedAt))}</span>}
              </div>
            )}
          </form>
        )}
      </section>
    </div>
  );
}

function ComingSoonPage({ page, onDashboard }: { page: string; onDashboard: () => void }) {
  return (
    <div className="coming-page">
      <div className="coming-icon">{page === "Insurance" ? <ShieldCheck size={25} /> : page === "Mortgage" ? <House size={25} /> : <ChartNoAxesCombined size={25} />}</div>
      <div className="eyebrow">ON THE ROADMAP</div>
      <h1>{page}</h1>
      <p>This part of your finance dashboard is planned for a later phase. Your dashboard and settings are ready to use now.</p>
      <button className="primary-button" onClick={onDashboard}>Back to dashboard <ArrowRight size={15} /></button>
    </div>
  );
}

function DashboardUnavailable({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="coming-page">
      <div className="coming-icon"><CircleHelp size={25} /></div>
      <div className="eyebrow">LOCAL DASHBOARD</div>
      <h1>Your dashboard couldn’t load</h1>
      <p>{error || "Your saved information is still on this device. Try connecting to the local app again."}</p>
      <button className="primary-button" onClick={onRetry}>Try again <ArrowRight size={15} /></button>
    </div>
  );
}
