import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, CircleHelp, Clock3,
  LogIn, MoreHorizontal, Plus, Search, Sparkles, X
} from 'lucide-react';
import { hasSupabaseConfig, supabase, supabaseConfigurationError } from './supabase';

const SEED_PROJECTS = [
  { id: 'seed-ticket', name: 'osTicket', color: '#48a58c', archived_at: null, system_key: 'osticket', is_shared: true },
  { id: 'seed-meetings', name: 'Meetings', color: '#5574d9', archived_at: null, system_key: 'meetings', is_shared: false },
  { id: 'seed-web', name: 'New Website', color: '#b47ad5', archived_at: null, system_key: null, is_shared: false },
];
const COLORS = ['#5574d9', '#48a58c', '#b47ad5', '#e0a451', '#dc7182', '#5f9caf', '#87934a', '#8d78c2'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_ZONE = 'America/Toronto';
const dateKey = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
const dateFromKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const zonedDateKey = (instant = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${part.year}-${part.month}-${part.day}`;
};
const monthForKey = (key) => { const [year, month] = key.split('-').map(Number); return new Date(Date.UTC(year, month - 1, 1, 12)); };
const monthLabel = (date) => date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const addDays = (key, amount) => { const date = dateFromKey(key); date.setUTCDate(date.getUTCDate() + amount); return dateKey(date); };
const dateLabel = (key, options) => dateFromKey(key).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
const weekStartFor = (key) => addDays(key, -dateFromKey(key).getUTCDay());
const hourLabel = (hour) => `${hour % 12 || 12}${hour < 12 ? ' AM' : ' PM'}`;
const initials = (email = '') => email.split('@')[0].split(/[._-]/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'P';
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

function App() {
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(!hasSupabaseConfig);
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [month, setMonth] = useState(() => monthForKey(zonedDateKey()));
  const [selectedDate, setSelectedDate] = useState(() => zonedDateKey());
  const [activeView, setActiveView] = useState('calendar');
  const [sharedProjectId, setSharedProjectId] = useState(null);
  const [weekFocus, setWeekFocus] = useState(() => zonedDateKey());
  const [occupiedSlots, setOccupiedSlots] = useState([]);
  const [ownClaims, setOwnClaims] = useState([]);
  const [weekLoggedSlots, setWeekLoggedSlots] = useState([]);
  const [availabilityForWeek, setAvailabilityForWeek] = useState('');
  const [availabilityError, setAvailabilityError] = useState('');
  const [bookingPending, setBookingPending] = useState('');
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const availabilityRequest = useRef(0);
  const [projects, setProjects] = useState(SEED_PROJECTS);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState(COLORS[0]);
  const [editor, setEditor] = useState(null);
  const [query, setQuery] = useState('');
  const [selectedProjects, setSelectedProjects] = useState([]);

  const user = session?.user;
  const todayKey = zonedDateKey();
  const monthStart = useMemo(() => dateKey(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1, 12))), [month]);
  const monthEnd = useMemo(() => dateKey(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0, 12))), [month]);
  const weekStart = useMemo(() => weekStartFor(weekFocus), [weekFocus]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setSessionChecked(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionChecked(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  }, []);

  const loadData = useCallback(async () => {
    if (!user || !supabase) return;
    setLoading(true);
    const [projectResult, entryResult] = await Promise.all([
      supabase.from('projects').select('id,user_id,name,color,archived_at,system_key,is_shared,claimed_once_at').order('created_at'),
      supabase.from('work_entries').select('id,project_id,work_date,hour_slot,allocated_hours').gte('work_date', monthStart).lte('work_date', monthEnd).order('hour_slot'),
    ]);
    if (projectResult.error || entryResult.error) {
      notify(projectResult.error?.message || entryResult.error?.message || 'Could not load your work.');
    } else {
      setProjects(projectResult.data || []);
      setEntries(entryResult.data || []);
    }
    setLoading(false);
  }, [user, monthStart, monthEnd, notify]);

  useEffect(() => { loadData(); }, [loadData]);

  const refreshAvailability = useCallback(async () => {
    if (!user || !supabase || activeView !== 'shared' || !sharedProjectId) return;
    const requestId = ++availabilityRequest.current;
    setAvailabilityLoading(true);
    setAvailabilityError('');
    const [slotsResult, claimsResult, workResult] = await Promise.all([
      supabase.from('shared_project_booked_slots').select('project_id,work_date,hour_slot').eq('project_id', sharedProjectId).gte('work_date', weekStart).lte('work_date', weekEnd),
      supabase.from('shared_project_claims').select('project_id,work_date,hour_slot').eq('project_id', sharedProjectId).gte('work_date', weekStart).lte('work_date', weekEnd),
      supabase.from('work_entries').select('work_date,hour_slot').gte('work_date', weekStart).lte('work_date', weekEnd),
    ]);
    if (requestId !== availabilityRequest.current) return;
    if (slotsResult.error || claimsResult.error || workResult.error) {
      const message = slotsResult.error?.message || claimsResult.error?.message || workResult.error?.message || 'Could not load shared availability.';
      setAvailabilityError(message);
      notify(message);
    } else {
      setOccupiedSlots(slotsResult.data || []);
      setOwnClaims(claimsResult.data || []);
      setWeekLoggedSlots(workResult.data || []);
      setAvailabilityForWeek(`${sharedProjectId}:${weekStart}:${weekEnd}`);
    }
    setAvailabilityLoading(false);
  }, [user, activeView, sharedProjectId, weekStart, weekEnd, notify]);

  useEffect(() => { refreshAvailability(); }, [refreshAvailability]);

  useEffect(() => {
    if (!user || !supabase || activeView !== 'shared' || !sharedProjectId) return undefined;
    const channel = supabase.channel(`shared-project-slots-${sharedProjectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_project_booked_slots', filter: `project_id=eq.${sharedProjectId}` }, () => refreshAvailability())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, activeView, sharedProjectId, refreshAvailability]);

  const visibleProjects = projects.filter((project) => !project.archived_at && project.user_id === user?.id && !project.is_shared && project.system_key !== 'osticket');
  const osticketProject = projects.find((project) => project.user_id === user?.id && project.system_key === 'osticket' && !project.archived_at);
  const calendarProjects = osticketProject ? [...visibleProjects, osticketProject] : visibleProjects;
  const sharedProjects = projects.filter((project) => !project.archived_at && project.is_shared && project.system_key === null).sort((a, b) => a.name.localeCompare(b.name));
  const personalProjectCount = projects.filter((project) => project.user_id === user?.id && !project.archived_at && !project.system_key && !project.is_shared).length;
  const sharedProjectCount = projects.filter((project) => project.user_id === user?.id && !project.archived_at && !project.system_key && project.is_shared).length;
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const currentMonthEntries = entries.filter((entry) => entry.work_date >= monthStart && entry.work_date <= monthEnd);
  const totalHours = currentMonthEntries.reduce((sum, entry) => sum + Number(entry.allocated_hours), 0);
  const projectTotals = currentMonthEntries.reduce((totals, entry) => {
    totals[entry.project_id] = (totals[entry.project_id] || 0) + Number(entry.allocated_hours);
    return totals;
  }, {});
  const totalsList = Object.entries(projectTotals).map(([id, hours]) => ({ project: projectById.get(id), hours })).filter((item) => item.project).sort((a, b) => b.hours - a.hours);
  const summaryTotals = totalsList.slice(0, 4);
  const osticketTotal = totalsList.find((item) => item.project.system_key === 'osticket');
  if (osticketTotal && !summaryTotals.includes(osticketTotal) && summaryTotals.length) summaryTotals[summaryTotals.length - 1] = osticketTotal;
  const calendarCells = useMemo(() => {
    const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1, 12));
    const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0, 12)).getUTCDate();
    const offset = first.getUTCDay();
    const count = Math.ceil((offset + days) / 7) * 7;
    return Array.from({ length: count }, (_, i) => {
      const day = i - offset + 1;
      const date = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day, 12));
      return { date, key: dateKey(date), day, inMonth: day > 0 && day <= days };
    });
  }, [month]);
  const entriesByDate = useMemo(() => currentMonthEntries.reduce((map, entry) => {
    (map[entry.work_date] ||= []).push(entry);
    return map;
  }, {}), [currentMonthEntries]);

  async function signIn() {
    setAuthError('');
    if (!supabase) return;
    setAuthBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { hd: 'pmiloc.org', prompt: 'select_account' } },
    });
    if (error) { setAuthError(error.message); setAuthBusy(false); }
  }

  async function createProject(event) {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    if (user && personalProjectCount >= 3) { notify('You can create up to 3 personal projects.'); return; }
    const project = { name, color: newProjectColor };
    if (user) {
      const { data, error } = await supabase.from('projects').insert({ ...project, user_id: user.id }).select().single();
      if (error) { notify(error.message); return; }
      setProjects((items) => [...items, data]);
    } else {
      setProjects((items) => [...items, { ...project, id: uid(), archived_at: null }]);
    }
    setNewProjectName(''); setShowProjectForm(false); notify(`${name} added`);
  }

  async function archiveProject(project) {
    if (project.system_key === 'meetings' || project.system_key === 'osticket' || project.claimed_once_at) return;
    if (!window.confirm(`Remove “${project.name}” from your projects? Existing calendar entries will be kept.`)) return;
    if (user) {
      const { error } = await supabase.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', project.id);
      if (error) { notify(error.message); return; }
    }
    setProjects((items) => items.map((item) => item.id === project.id ? { ...item, archived_at: new Date().toISOString() } : item));
    notify(`${project.name} removed`);
  }

  async function toggleProjectSharing(project) {
    const makeShared = !project.is_shared;
    if (makeShared && sharedProjectCount >= 3) { notify('You can share up to 3 of your projects.'); return; }
    const { error } = await supabase.rpc('set_project_shared', { p_project_id: project.id, p_is_shared: makeShared });
    if (error) { notify(error.message); return; }
    setProjects((items) => items.map((item) => item.id === project.id ? { ...item, is_shared: makeShared } : item));
    notify(makeShared ? `${project.name} is now shared` : `${project.name} is private`);
  }

  async function saveHour(hour) {
    if (!editor || !selectedProjects.length) return;
    const sharedProject = selectedProjects.map((id) => projectById.get(id)).find((project) => project?.system_key === 'osticket');
    if (sharedProject) {
      if (selectedProjects.length > 1) { notify('osTicket claims reserve the full hour by themselves.'); return; }
      const claimed = await claimSharedHour(sharedProject.id, editor.date, Number(hour));
      if (!claimed) return;
      setEditor(null); setSelectedProjects([]); setQuery('');
      return;
    }
    const baseAllocation = Math.floor(1000 / selectedProjects.length) / 1000;
    const remainder = Math.round((1 - baseAllocation * selectedProjects.length) * 1000) / 1000;
    const rows = selectedProjects.map((projectId, index) => ({ user_id: user?.id, project_id: projectId, work_date: editor.date, hour_slot: Number(hour), allocated_hours: baseAllocation + (index === 0 ? remainder : 0) }));
    if (user) {
      const { error } = await supabase.from('work_entries').insert(rows);
      if (error) { notify(error.message.includes('cannot exceed one hour') ? 'This hour is already full. Remove an entry before adding another.' : error.message); return; }
    }
    setEntries((items) => [...items, ...rows.map((row) => ({ ...row, id: uid() }))]);
    setEditor(null); setSelectedProjects([]); setQuery(''); notify('Work hour added');
  }

  async function deleteEntry(entry) {
    const targetProject = projectById.get(entry.project_id);
    if (targetProject?.is_shared) {
      await releaseSharedHour(entry.project_id, entry.work_date, entry.hour_slot);
      return;
    }
    const slotEntries = entries.filter((item) => item.work_date === entry.work_date && item.hour_slot === entry.hour_slot && projectById.get(item.project_id)?.system_key !== 'osticket' && !projectById.get(item.project_id)?.is_shared);
    if (!slotEntries.length) return;
    if (user) {
      const { error } = await supabase.from('work_entries').delete().in('id', slotEntries.map((item) => item.id));
      if (error) { notify(error.message); return; }
    }
    const deletedIds = new Set(slotEntries.map((item) => item.id));
    setEntries((items) => items.filter((item) => !deletedIds.has(item.id)));
    notify('Work entry removed');
  }

  async function claimSharedHour(projectId, date, hour) {
    const key = `${projectId}:${date}:${hour}`;
    setBookingPending(key);
    const { error } = await supabase.rpc('claim_shared_project_hour', { p_project_id: projectId, p_work_date: date, p_hour_slot: hour });
    setBookingPending('');
    if (error) {
      await refreshAvailability();
      notify(error.message.includes('already claimed') ? 'Someone just claimed that hour. Choose another block.' : error.message.includes('already has work') ? 'You already have another project logged in that hour.' : error.message);
      return false;
    }
    setOccupiedSlots((items) => [...items.filter((item) => !(item.work_date === date && item.hour_slot === hour)), { work_date: date, hour_slot: hour }]);
    setOwnClaims((items) => [...items.filter((item) => !(item.work_date === date && item.hour_slot === hour)), { work_date: date, hour_slot: hour }]);
    setWeekLoggedSlots((items) => [...items.filter((item) => !(item.work_date === date && item.hour_slot === hour)), { work_date: date, hour_slot: hour }]);
    await loadData();
    notify(`${projectById.get(projectId)?.name || 'Project'} hour claimed`);
    return true;
  }

  async function releaseSharedHour(projectId, date, hour) {
    const key = `${projectId}:${date}:${hour}`;
    setBookingPending(key);
    const { error } = await supabase.rpc('release_shared_project_hour', { p_project_id: projectId, p_work_date: date, p_hour_slot: hour });
    setBookingPending('');
    if (error) { notify(error.message); return; }
    setOccupiedSlots((items) => items.filter((item) => !(item.work_date === date && item.hour_slot === hour)));
    setOwnClaims((items) => items.filter((item) => !(item.work_date === date && item.hour_slot === hour)));
    setWeekLoggedSlots((items) => items.filter((item) => !(item.work_date === date && item.hour_slot === hour)));
    await loadData();
    notify(`${projectById.get(projectId)?.name || 'Project'} hour released`);
  }

  function openEditor(date, hour) {
    const alreadyUsed = (entriesByDate[date] || []).filter((entry) => entry.hour_slot === hour).reduce((sum, entry) => sum + Number(entry.allocated_hours), 0);
    if (alreadyUsed >= 0.999) { notify('That hour is already fully allocated.'); return; }
    setEditor({ date, hour }); setSelectedProjects([]); setQuery('');
  }

  function moveWeek(amount) {
    const nextFocus = addDays(weekFocus, amount * 7);
    setWeekFocus(nextFocus);
    setMonth(monthForKey(nextFocus));
  }

  function showCurrentWeek() {
    const today = zonedDateKey();
    setWeekFocus(today);
    setMonth(monthForKey(today));
  }

  if (!sessionChecked) return <div className="loading-screen"><span className="brand-mark"><CalendarDays size={21} /></span><span>Getting your calendar ready</span></div>;
  if (!user) return <LoginScreen configured={hasSupabaseConfig} configError={supabaseConfigurationError} onSignIn={signIn} busy={authBusy} error={authError} />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-row"><span className="brand-mark"><CalendarDays size={20} /></span><span className="brand-name">daymark</span><span className="brand-dot" /></div>
      <div className="workspace-tag"><span className="workspace-icon">P</span><span><b>PMILOC</b><small>Personal workspace</small></span><ChevronDown size={15} /></div>
      <nav className="primary-nav" aria-label="Main navigation"><button className={`primary-nav-link ${activeView === 'calendar' ? 'active' : ''}`} onClick={() => setActiveView('calendar')} aria-label="My calendar" aria-current={activeView === 'calendar' ? 'page' : undefined}><CalendarDays size={15} /><span>My calendar</span></button></nav>
      <div className="shared-nav-section"><div className="side-section-head"><span>SHARED SCHEDULES</span></div>
        {projects.filter((project) => project.system_key === 'osticket' && !project.archived_at).map((project) => <ProjectRow key={project.id} project={project} active={activeView === 'shared' && sharedProjectId === project.id} showShared={false} onOpen={() => { setActiveView('shared'); setSharedProjectId(project.id); setWeekFocus(todayKey); setMonth(monthForKey(todayKey)); }} />)}
      </div>
      <div className="side-section-head"><span>YOUR PROJECTS</span><button className="icon-button add-project-mini" onClick={() => setShowProjectForm(true)} title="Create project" aria-label="Create project" disabled={personalProjectCount >= 3}><Plus size={17} /></button></div>
      <div className="project-list">
        {visibleProjects.map((project) => <ProjectRow key={project.id} project={project} active={false} showShared={project.system_key === 'meetings'} onRemove={() => archiveProject(project)} onToggleShared={() => toggleProjectSharing(project)} canShare={sharedProjectCount < 3 || project.is_shared} canMakePrivate={personalProjectCount < 3} shareDisabled={Boolean(project.claimed_once_at)} canRemove={!project.claimed_once_at} canManage={!project.system_key} />)}
        {showProjectForm && <form className="new-project" onSubmit={createProject}>
          <div className="new-project-name"><span className="project-dot" style={{ background: newProjectColor }} /><input autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Project name" maxLength={80} /></div>
          <div className="color-options">{COLORS.map((color) => <button key={color} type="button" className={`color-choice ${newProjectColor === color ? 'selected' : ''}`} style={{ '--swatch': color }} onClick={() => setNewProjectColor(color)} aria-label={`Choose ${color}`} />)}</div>
          <div className="form-actions"><button type="button" className="text-button" onClick={() => setShowProjectForm(false)}>Cancel</button><button className="small-primary" disabled={!newProjectName.trim()}>Add project</button></div>
        </form>}
      </div>
      {!showProjectForm && <button className="create-project-button" disabled={personalProjectCount >= 3} title={personalProjectCount >= 3 ? 'You have reached the 3 project limit' : undefined} onClick={() => setShowProjectForm(true)}><Plus size={16} /> {personalProjectCount >= 3 ? '3 project limit reached' : 'Create a project'}</button>}
      {sharedProjects.length > 0 && <><div className="side-section-head shared-project-heading"><span>SHARED PROJECTS</span></div><div className="project-list">{sharedProjects.map((project) => <ProjectRow key={project.id} project={project} active={activeView === 'shared' && sharedProjectId === project.id} showShared onOpen={() => { setActiveView('shared'); setSharedProjectId(project.id); setWeekFocus(todayKey); setMonth(monthForKey(todayKey)); }} onRemove={() => archiveProject(project)} onToggleShared={() => toggleProjectSharing(project)} shareDisabled={Boolean(project.claimed_once_at)} canRemove={!project.claimed_once_at} canMakePrivate={personalProjectCount < 3} canShare canManage={project.user_id === user.id} />)}</div></>}
      <div className="sidebar-bottom"><div className="tips-card"><div className="tips-icon"><Sparkles size={15} /></div><b>Make time count</b><p>Log your project hours as you go. Your month at a glance is right here.</p></div><div className="user-row"><span className="avatar">{initials(user.email)}</span><span className="user-meta"><b>{user.email?.split('@')[0]}</b><small>{user.email}</small></span><span className="online-dot" aria-label="Signed in" /></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><b>My calendar</b></div><div className="topbar-right"><span className="private-label"><span /> {activeView === 'osticket' ? 'Shared availability' : 'Private to you'}</span><span className="top-avatar">{initials(user.email)}</span></div></header>
      <div className="content-wrap">
        <section className="page-intro"><div><div className="eyebrow">YOUR WORK, IN RHYTHM</div><h1>My calendar</h1><p>Plan your time. See where your month went.</p></div><div className="today-badge"><span className="today-icon"><CalendarDays size={16} /></span><span><small>TODAY · TORONTO</small><b>{dateLabel(todayKey, { month: 'short', day: 'numeric' })}</b></span></div></section>
        <section className="summary-card" aria-label="Monthly summary"><div className="summary-total"><span className="summary-icon"><Clock3 size={19} /></span><div><span className="summary-label">TOTAL THIS MONTH</span><div className="summary-number">{formatHours(totalHours)}<span> hrs</span></div></div></div><div className="summary-divider" /><div className="summary-projects"><div className="summary-topline"><span className="summary-label">PROJECT BREAKDOWN</span><span className="project-count">{totalsList.length} {totalsList.length === 1 ? 'project' : 'projects'}</span></div><div className="breakdown-list">{totalsList.length ? summaryTotals.map(({ project, hours }) => <div className="breakdown-item" key={project.id}><span className="breakdown-name"><i style={{ background: project.color }} />{project.name}</span><b>{formatHours(hours)}h</b></div>) : <span className="empty-breakdown">Your project hours will show up here.</span>}</div></div><div className="summary-month"><span className="month-mini-icon"><CalendarDays size={16} /></span><div><span className="summary-label">VIEWING</span><b>{monthLabel(month)}</b></div></div></section>
        {activeView === 'shared' ? <OsticketWeekCard project={projectById.get(sharedProjectId)} weekDates={weekDates} weekStart={weekStart} weekEnd={weekEnd} today={todayKey} occupiedSlots={occupiedSlots} ownClaims={ownClaims} loggedSlots={weekLoggedSlots} loading={availabilityLoading} error={availabilityError} ready={availabilityForWeek === `${sharedProjectId}:${weekStart}:${weekEnd}` && !availabilityLoading && !availabilityError} pending={bookingPending} onPrevious={() => moveWeek(-1)} onNext={() => moveWeek(1)} onToday={showCurrentWeek} onClaim={(date, hour) => claimSharedHour(sharedProjectId, date, hour)} onRelease={(date, hour) => releaseSharedHour(sharedProjectId, date, hour)} onRetry={refreshAvailability} /> : <section className="calendar-card">
          <div className="calendar-toolbar"><div className="calendar-heading"><h2>{monthLabel(month)}</h2><span className="entry-subtitle">{totalHours ? `${formatHours(totalHours)} hours logged` : 'Your time, thoughtfully organized'}</span></div><div className="calendar-actions"><button className="today-button" onClick={() => { setMonth(monthForKey(todayKey)); setSelectedDate(todayKey); }}>Today</button><div className="month-controls"><button aria-label="Previous month" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1, 12)))}><ArrowLeft size={17} /></button><button aria-label="Next month" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1, 12)))}><ArrowRight size={17} /></button></div></div></div>
          <div className="calendar-grid" role="grid" aria-label={monthLabel(month)}><div className="weekday-row" role="row">{WEEKDAYS.map((day) => <div className="weekday" role="columnheader" key={day}>{day}</div>)}</div><div className="days-grid">{calendarCells.map(({ date, key, day, inMonth }) => {
            const dayEntries = entriesByDate[key] || [];
            const displayEntries = [...dayEntries].sort((a, b) => a.hour_slot - b.hour_slot || a.project_id.localeCompare(b.project_id)).map((entry) => ({ ...entry, project: projectById.get(entry.project_id) })).filter((entry) => entry.project);
            const isToday = key === todayKey;
            return <div role="gridcell" key={key} className={`day-cell ${!inMonth ? 'outside-month' : ''} ${selectedDate === key ? 'selected-day' : ''}`} onClick={() => { if (inMonth) setSelectedDate(key); }} onKeyDown={(event) => { if (inMonth && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSelectedDate(key); } }} tabIndex={inMonth ? 0 : -1} aria-label={`${dateLabel(key, { weekday: 'long', month: 'long', day: 'numeric' })}${dayEntries.length ? `, ${formatHours(dayEntries.reduce((sum, entry) => sum + Number(entry.allocated_hours), 0))} hours` : ''}`}>
              <div className="day-top"><span className={`day-number ${isToday ? 'is-today' : ''}`}>{date.getDate()}</span>{dayEntries.length > 0 && <span className="day-hours">{formatHours(dayEntries.reduce((sum, entry) => sum + Number(entry.allocated_hours), 0))}h</span>}</div>
              <div className="day-projects">{displayEntries.slice(0, 3).map((entry) => <div key={entry.id} className={`calendar-project ${entry.project.is_shared ? 'calendar-project-claimed' : ''}`} title={`${String(entry.hour_slot).padStart(2, '0')}:00 · ${entry.project.name} · ${entry.project.is_shared ? 'Claimed' : formatHours(entry.allocated_hours) + ' hours'}`}><span className="calendar-project-dot" style={{ background: entry.project.color }} /><span className="calendar-project-name">{entry.project.name}</span><span className="calendar-project-hours">{String(entry.hour_slot).padStart(2, '0')}h</span>{(entry.project.is_shared || entry.project.system_key !== 'osticket') && <button className="entry-remove" aria-label={entry.project.is_shared ? `Release claimed ${entry.project.name} hour at ${hourLabel(entry.hour_slot)}` : `Remove entire ${String(entry.hour_slot).padStart(2, '0')}:00 hour block`} onClick={(event) => { event.stopPropagation(); deleteEntry(entry); }}><X size={12} /></button>}</div>)}{displayEntries.length > 3 && <span className="more-projects">+{displayEntries.length - 3} more entries</span>}</div>
              {inMonth && <button className="day-add" aria-label={`Add hours on ${dateLabel(key)}`} onClick={(event) => { event.stopPropagation(); setSelectedDate(key); setEditor({ date: key, hour: null }); setSelectedProjects([]); }}> <Plus size={14} /> <span>Add time</span></button>}
            </div>;
          })}</div></div>
          <div className="calendar-footer"><span><span className="footer-dot" />Click any day to add an hour</span><button onClick={() => { setSelectedDate(todayKey); setEditor({ date: todayKey, hour: null }); setSelectedProjects([]); }}><Plus size={14} /> Log time</button></div>
        </section>}
        <div className="privacy-note"><span className="privacy-shield">✓</span>Your calendar is private to your PMILOC account<span className="note-separator">·</span><button title="Your entries and projects are only visible to you.">Learn about privacy <CircleHelp size={13} /></button></div>
      </div>
    </main>
    {editor && <HourDialog editor={editor} selectedDate={selectedDate} projects={calendarProjects} entries={editor.date ? entriesByDate[editor.date] || [] : []} selectedProjects={selectedProjects} setSelectedProjects={setSelectedProjects} query={query} setQuery={setQuery} onClose={() => setEditor(null)} onSave={saveHour} />}
    {loading && <div className="sync-indicator"><span />Syncing</div>}
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
  </div>;
}

function LoginScreen({ configured, configError, onSignIn, busy, error }) {
  return <div className="login-page"><div className="login-top"><div className="brand-row"><span className="brand-mark"><CalendarDays size={20} /></span><span className="brand-name">daymark</span></div><span className="login-company">A calmer way to track your work</span></div><div className="login-content"><div className="login-copy"><div className="eyebrow">MADE FOR YOUR WORKDAY</div><h1>Make room for<br /><em>meaningful work.</em></h1><p>A simple place to plan your project time, keep track of the hours, and see your month take shape.</p><div className="login-proof"><span className="proof-avatars"><i>J</i><i>A</i><i>M</i><i>+</i></span><span>Just your team, doing good work.</span></div></div><div className="login-panel"><div className="login-panel-icon"><CalendarDays size={22} /></div><h2>Welcome to Daymark</h2><p>Sign in with your PMILOC Google account to continue.</p><button className="google-button" onClick={onSignIn} disabled={!configured || busy}><GoogleMark />{busy ? 'Connecting…' : 'Continue with Google'}<LogIn size={16} /></button>{!configured && <div className="config-help"><b>Supabase connection needed</b><span>{configError || 'Add your project URL and anon key to .env.local, then restart the dev server.'}</span><span>Environment values must be real Supabase values. Never prefix the anon key with a service role key.</span></div>}{error && <div className="auth-error" role="alert">{error}</div>}<div className="login-panel-foot"><span className="lock-mini">⌑</span>Only <b>@pmiloc.org</b> accounts can access Daymark</div></div></div><div className="login-bottom"><span>© {new Date().getFullYear()} PMILOC</span><span>Simple tools for focused teams</span><span>Private by design <span className="bottom-dot">·</span> Built for your work</span></div></div>;
}

function GoogleMark() { return <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.93c-.58 2.96-2.26 5.48-4.73 7.18l7.64 5.93c4.47-4.13 7.14-10.2 7.14-17.58z"/><path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.87l-7.64-5.93c-2.13 1.43-4.86 2.27-8.26 2.27-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>; }

function ProjectRow({ project, onRemove, onOpen, active, showShared = false, onToggleShared, canShare = true, canMakePrivate = true, shareDisabled = false, canRemove = true, canManage = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className={`project-row ${active ? 'active-project' : ''}`}>
    <button className="project-open-button" onClick={onOpen} disabled={!onOpen} aria-label={onOpen ? `Open shared ${project.name} schedule` : project.name} aria-current={active ? 'page' : undefined} title={onOpen ? `Open shared ${project.name} schedule` : undefined}>
      <span className="project-dot" style={{ background: project.color }} /><span className="project-row-name">{project.name}</span>{showShared && <span className="shared-badge">Shared</span>}
    </button>
    {canManage && <button className="project-menu-button" aria-label={`Project options for ${project.name}`} onClick={() => setMenuOpen(!menuOpen)}><MoreHorizontal size={17} /></button>}
    {menuOpen && <><button className="menu-scrim" aria-label="Close project menu" onClick={() => setMenuOpen(false)} /><div className="project-menu">
      {onToggleShared && <button disabled={project.is_shared ? (shareDisabled || !canMakePrivate) : !canShare} title={shareDisabled ? 'This project has been used for a shared booking' : !canMakePrivate && project.is_shared ? 'Your personal project limit is full' : !canShare && !project.is_shared ? 'You can share up to 3 projects' : undefined} onClick={() => { onToggleShared(); setMenuOpen(false); }}>{project.is_shared ? (canMakePrivate ? 'Make private' : 'Personal project limit reached') : canShare ? 'Make shared' : 'Shared project limit reached'}</button>}
      {canRemove && <button onClick={() => { onRemove?.(); setMenuOpen(false); }}>Remove project</button>}
    </div></>}
  </div>;
}

function OsticketWeekCard({ project, weekDates, weekStart, weekEnd, today, occupiedSlots, ownClaims, loggedSlots, loading, error, ready, pending, onPrevious, onNext, onToday, onClaim, onRelease, onRetry }) {
  const occupiedKeys = new Set(occupiedSlots.map((slot) => `${slot.work_date}:${slot.hour_slot}`));
  const ownedKeys = new Set(ownClaims.map((slot) => `${slot.work_date}:${slot.hour_slot}`));
  const loggedKeys = new Set(loggedSlots.map((slot) => `${slot.work_date}:${slot.hour_slot}`));
  const dateRange = weekStart.slice(0, 7) === weekEnd.slice(0, 7)
    ? `${dateLabel(weekStart, { month: 'long' })} ${dateLabel(weekStart, { day: 'numeric' })} – ${dateLabel(weekEnd, { day: 'numeric', year: 'numeric' })}`
    : `${dateLabel(weekStart, { month: 'short', day: 'numeric' })} – ${dateLabel(weekEnd, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return <section className="calendar-card osticket-week-card">
    <div className="calendar-toolbar"><div className="calendar-heading"><h2>{dateRange}</h2><span className="entry-subtitle">Shared {project?.name || 'project'} hours · Toronto time</span></div><div className="calendar-actions"><button className="today-button" onClick={onToday}>This week</button><div className="month-controls"><button aria-label="Previous week" onClick={onPrevious}><ArrowLeft size={17} /></button><button aria-label="Next week" onClick={onNext}><ArrowRight size={17} /></button></div></div></div>
    <div className="osticket-legend"><span><i className="legend-free" />A · Available</span><span><i className="legend-taken" />R · Reserved</span><span><i className="legend-yours" />Claimed by you</span><span><i className="legend-logged" />Blocked by your calendar</span>{project?.system_key === 'osticket' && <span>8 AM–10 PM</span>}{loading && <span className="availability-refresh"><span />Updating availability</span>}{error && <span className="availability-failure" role="alert">Could not load slots <button onClick={onRetry}>Retry</button></span>}</div>
    <div className="week-scroll" role="grid" aria-label={`Shared ${project?.name || 'project'} schedule for ${dateRange}`}>
      <div className="week-grid-head" role="row"><div className="week-time-heading" role="columnheader">TORONTO</div>{weekDates.map((date) => <div className={`week-day-heading ${date === today ? 'today-week-column' : ''}`} role="columnheader" key={date}><span>{dateLabel(date, { weekday: 'short' })}</span><b>{dateLabel(date, { day: 'numeric' })}</b></div>)}</div>
    <div className="week-hour-grid">{Array.from({ length: project?.system_key === 'osticket' ? 14 : 24 }, (_, index) => index + (project?.system_key === 'osticket' ? 8 : 0)).map((hour) => <div className="week-hour-row" role="row" key={hour}><div className="week-hour-label" role="rowheader">{hourLabel(hour)}</div>{weekDates.map((date) => {
        const key = `${date}:${hour}`;
        const isOccupied = occupiedKeys.has(key);
        const isOwned = ownedKeys.has(key);
        const isLogged = loggedKeys.has(key) && !isOwned;
        const isPending = pending === `${project?.id}:${key}`;
        const label = !ready ? (error ? 'Unavailable' : 'Loading') : isOwned ? 'Your booking' : isOccupied ? 'Reserved' : isLogged ? 'Already blocked' : 'Available';
        return <div className="week-slot-cell" role="gridcell" key={key}><button className={`week-slot ${!ready ? 'slot-loading' : isOwned ? 'slot-owned' : isOccupied ? 'slot-reserved' : isLogged ? 'slot-logged' : 'slot-free'} ${isPending ? 'slot-pending' : ''}`} disabled={!ready || isPending || ((isOccupied || isLogged) && !isOwned)} onClick={() => isOwned ? onRelease(date, hour) : onClaim(date, hour)} aria-label={`${dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric' })}, ${hourLabel(hour)} to ${hourLabel((hour + 1) % 24)}: ${isOwned && ready ? 'your claimed booking, click to release' : label.toLowerCase()}`} title={isOwned ? 'Claimed by you · click to release' : isOccupied ? 'Reserved by another user' : isLogged ? 'Already blocked by your other project' : 'Available · click to claim'}>{!ready ? '—' : isPending ? '…' : isOwned ? 'Claimed' : isOccupied ? 'R' : isLogged ? 'Blocked' : 'A'}</button></div>;
      })}</div>)}</div>
    </div>
    <div className="calendar-footer"><span><span className="footer-dot" />Select an available hour to claim it. You can release your own hours.</span><span className="week-time-note">All dates and times use America/Toronto.</span></div>
  </section>;
}

function HourDialog({ editor, projects, entries, selectedProjects, setSelectedProjects, query, setQuery, onClose, onSave }) {
  const [hour, setHour] = useState(editor.hour ?? '');
  const occupiedHours = new Set(entries.map((entry) => entry.hour_slot));
  const selectingOsticket = selectedProjects.some((id) => projects.some((project) => project.id === id && project.system_key === 'osticket'));
  const filteredProjects = projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase()));
  const chosenHours = selectedProjects.length ? (1 / selectedProjects.length) : 0;
  const dayLabel = dateFromKey(editor.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const selectableHours = selectingOsticket ? Array.from({ length: 14 }, (_, index) => index + 8) : Array.from({ length: 24 }, (_, index) => index);
  function toggleProject(project, checked) {
    if (project.system_key === 'osticket') {
      if (!checked && (Number(hour) < 8 || Number(hour) > 21)) setHour('');
      setSelectedProjects(checked ? [] : [project.id]);
      return;
    }
    setSelectedProjects((ids) => {
      const privateIds = ids.filter((id) => !projects.some((candidate) => candidate.id === id && candidate.system_key === 'osticket'));
      return checked ? privateIds.filter((id) => id !== project.id) : [...privateIds, project.id];
    });
  }
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="hour-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-top"><div><div className="eyebrow">ADD TO YOUR CALENDAR</div><h2 id="dialog-title">Log project time</h2><p>{dayLabel}</p></div><button className="dialog-close" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div><div className="dialog-body"><label className="field-label" htmlFor="hour-select">Choose an hour</label><div className="hour-select-wrap"><Clock3 size={17} /><select id="hour-select" value={hour} onChange={(event) => setHour(event.target.value)}><option value="">Select a one-hour block</option>{selectableHours.map((value) => { const label = `${String(value).padStart(2, '0')}:00 – ${String((value + 1) % 24).padStart(2, '0')}:00`; return <option key={value} value={value} disabled={occupiedHours.has(value)}>{label}{occupiedHours.has(value) ? ' · already blocked' : ''}</option>; })}</select><ChevronDown size={16} /></div><label className="field-label project-picker-label" htmlFor="project-search">Choose project(s) <span>Select more than one to split the hour</span></label><div className="project-search"><Search size={16} /><input id="project-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a project…" /></div><div className="project-picker-list">{filteredProjects.map((project) => { const checked = selectedProjects.includes(project.id); return <button key={project.id} className={`picker-project ${checked ? 'checked' : ''}`} onClick={() => toggleProject(project, checked)}><span className="picker-color" style={{ background: project.color }} /><span>{project.name}</span>{project.system_key === 'osticket' && <small className="picker-shared-note">Shared · full hour</small>}{checked && <span className="picker-share">{project.system_key === 'osticket' ? '1h' : `${formatHours(chosenHours)}h`}</span>}<span className={`check-box ${checked ? 'on' : ''}`}>{checked && <Check size={13} />}</span></button>; })}{!filteredProjects.length && <div className="no-projects">No matching projects. Create one from the sidebar.</div>}</div>{selectedProjects.length > 0 && <div className="split-note"><span className="split-icon"><Sparkles size={15} /></span><span><b>{selectingOsticket ? 'Shared osTicket booking' : 'Hour split evenly'}</b><small>{selectingOsticket ? 'Reserves the hour in the shared schedule' : `${formatHours(chosenHours)} hour${chosenHours === 1 ? '' : 's'} to each of ${selectedProjects.length} project${selectedProjects.length === 1 ? '' : 's'}`}</small></span><b className="split-total">1h total</b></div>}</div><div className="dialog-footer"><button className="cancel-button" onClick={onClose}>Cancel</button><button className="save-button" disabled={hour === '' || !selectedProjects.length} onClick={() => onSaveWithHour(onSave, hour)}>{selectingOsticket ? 'Claim osTicket hour' : 'Add to calendar'} <ArrowRight size={15} /></button></div></section></div>;
}

function onSaveWithHour(onSave, hour) { onSave(Number(hour)); }
function formatHours(value) { return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }

export default App;
