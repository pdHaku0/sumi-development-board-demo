import { buildPlan } from './planning.js';
import { layoutFlow, activeRuns, readyToStart } from './flow.js';
import { orthogonalRoute, routePath } from './routing.js';
import './viewport.js';
import { spaceProseArrows } from './typography.js';
import { clearPanelGhost, retirePanel, settleDetail, revealScope, pulseProgress } from './motion.js';
let routeCache={key:'',paths:new Map()};
const icons = {
  arrow: '<path d="M4 9h10M10 5l4 4-4 4"/>',
  external: '<path d="M5 13 13 5M5 5h8v8"/>',
  check: '<path d="m4 9 3 3 7-7"/>',
  ready: '<path d="m6 4 8 5-8 5Z"/>',
  close: '<path d="m5 5 8 8M13 5l-8 8"/>',
  pause: '<path d="M6 4v10M12 4v10"/>',
  search: '<circle cx="7.5" cy="7.5" r="4.5"/><path d="m11 11 4 4"/>',
  refresh: '<path d="M14 6a5.5 5.5 0 1 0 .5 5M14 2v4h-4"/>',
  link: '<path d="m7 11 4-4M6 8 4.5 9.5a2.8 2.8 0 0 0 4 4L10 12M8 6l1.5-1.5a2.8 2.8 0 0 1 4 4L12 10"/>',
  monitor: '<rect x="2" y="3" width="14" height="10" rx="1"/><path d="M6 16h6M9 13v3"/>',
  expand: '<path d="M3 7V3h4m4 0h4v4M3 11v4h4m4 0h4v-4"/>',
  shrink: '<path d="M7 3v4H3m12 0h-4V3M3 11h4v4m4 0v-4h4"/>',
  download: '<path d="M9 2v9m-4-4 4 4 4-4M3 12v3h12v-3"/>',
};
const icon = (name) => `<svg viewBox="0 0 18 18" aria-hidden="true">${icons[name] || icons.arrow}</svg>`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url = (value) => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? esc(u.href) : ''; } catch { return ''; } };
const external = (href, label, className='') => url(href) ? `<a class="${className}" href="${url(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}${icon('external')}</a>` : `<span>${esc(label)}</span>`;
const stages = [{id:'plan',label:'設計'},{id:'build',label:'実装'},{id:'review',label:'レビュー'},{id:'integrate',label:'統合・確認'},{id:'live',label:'利用可能'}];
const statusNames = {planned:'準備中',active:'進行中',review:'確認中',blocked:'待機中',done:'完了'};
const resultNames = {todo:'未確認',passed:'確認できた',failed:'うまくいかない',blocked:'まだ試せない'};
const workerNames = {running:'作業中',finished:'返答あり',completed:'返答あり',permission_blocked:'実行条件の確認待ち',blocked:'実行条件の確認待ち',usage_limited:'利用枠の回復待ち',limited:'利用枠の回復待ち',failed:'対応待ち',stopped:'停止中',starting:'起動中',unknown:'状態未確認',exited:'終了・結果未確認'};
const q = (sel) => document.querySelector(sel);
const content = q('#content'), panel = q('#task-panel');
// Related tasks use the accepted underlined-link treatment.
const storageKey = 'sumi.development-board.demo-20260917.observations.v1';
let chartFullscreen=false, nativeFullscreenOwned=false, orientationOwned=false, fullscreenEpoch=0, chartScrollMemory=null, chartPageMemory=null;
let liveSnapshot = false;
let data, view = 'overview', query = '', checkFilter = 'todo', selectedPhase = '', showDependencies = true, panelExpanded = false, currentTaskId = null, currentCheckId = null, hoveredTaskId = null, previousFocus, observations = {}, toastTimer, loading = false;
let restoringNavigation = false, navigationEpoch = 0;
let searchOpen = false, searchText = '', searchEntryKey = null, searchReturnFocus = null;
const mobileSearch = matchMedia('(max-width:700px), (orientation:landscape) and (max-width:1100px) and (max-height:600px)');
const navigationPositions = new Map();
const newNavigationKey=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
let navigationKey = history.state?.sumiBoard?.key || newNavigationKey();
history.replaceState({...history.state,sumiBoard:{...history.state?.sumiBoard,key:navigationKey}},'');
history.scrollRestoration = 'manual';
try { const stored=JSON.parse(localStorage.getItem(storageKey) || '{}'); if(stored && typeof stored==='object' && !Array.isArray(stored)) observations=stored; } catch { /* The board remains usable when browser storage is unavailable. */ }
q('#refresh').innerHTML = icon('refresh'); q('#search-icon').innerHTML = icon('search');
q('#search-bar-icon').innerHTML = icon('search'); q('[data-action="search-open"]').innerHTML = icon('search');

function date(value, full=false) {
  const d = new Date(value);
  if (!value || !Number.isFinite(d.getTime())) return '日時未記録';
  return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',...(full ? {hour:'2-digit',minute:'2-digit'} : {})}).format(d);
}
function time(value) { const d=new Date(value); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(d) : '—'; }
function toast(message) { clearTimeout(toastTimer); q('#toast').textContent=message; q('#toast').hidden=false; toastTimer=setTimeout(()=>q('#toast').hidden=true,3500); }
function taskById(id) { return data?.tasks.find(t=>t.id===id); }
function rememberPosition() {
  if(restoringNavigation||!data)return;
  const scroller=q('.board-scroll');
  navigationPositions.set(navigationKey,{
    x:scrollX,y:scrollY,left:scroller?.scrollLeft||0,top:scroller?.scrollTop||0,
    detail:panel.scrollTop,runs:q('.run-history-toggle')?.getAttribute('aria-expanded')==='true',
  });
}
function writeNavigation(mode='push') {
  if(restoringNavigation)return;
  const next=new URL(location.href);
  for(const [name,value] of Object.entries({
    phase:selectedPhase,view:view==='overview'?'':view,q:query,
    filter:checkFilter==='todo'?'':checkFilter,deps:showDependencies?'':'0',
    detail:currentTaskId&&panelExpanded?'full':'',
  })) {if(value)next.searchParams.set(name,value);else next.searchParams.delete(name);}
  // The phone search surface carries its own param so it never doubles as the
  // inline filter's q; an empty value still marks the surface as open.
  if(searchOpen)next.searchParams.set('search',searchText);else next.searchParams.delete('search');
  const hash=new URLSearchParams();
  if(currentTaskId){hash.set('task',currentTaskId);if(currentCheckId)hash.set('check',currentCheckId);}
  next.hash=hash.toString();
  if(next.href===location.href)return;
  if(mode==='push'){
    navigationKey=newNavigationKey();
    history.pushState({sumiBoard:{key:navigationKey}},'',next);
  }else history.replaceState({...history.state,sumiBoard:{...history.state?.sumiBoard,key:navigationKey}},'',next);
  rememberPosition();
}
function restoreNavigation() {
  if(!data)return;
  const epoch=++navigationEpoch;
  restoringNavigation=true;
  navigationKey=history.state?.sumiBoard?.key||newNavigationKey();
  if(!history.state?.sumiBoard?.key)history.replaceState({...history.state,sumiBoard:{key:navigationKey}},'');
  const position=navigationPositions.get(navigationKey)||history.state?.sumiBoard?.position;
  const params=new URLSearchParams(location.search),hash=new URLSearchParams(location.hash.slice(1));
  view=['overview','try','checks'].includes(params.get('view'))?params.get('view'):'overview';
  selectedPhase=data.phases?.some(p=>p.id===params.get('phase'))?params.get('phase'):'';
  query=params.get('q')||'';q('#search').value=query;
  checkFilter=['todo','passed','failed','blocked','all'].includes(params.get('filter'))?params.get('filter'):'todo';
  showDependencies=params.get('deps')!=='0';
  panelExpanded=params.get('detail')==='full';
  const wantsSearch=mobileSearch.matches&&params.has('search');
  const closedSearch=searchOpen&&!wantsSearch;
  if(wantsSearch){searchText=params.get('search')||'';if(!searchOpen)openSearch(false);else{q('#search-field').value=searchText;renderSearchResults();}}
  else if(searchOpen)closeSearch(false);
  const task=taskById(hash.get('task'));
  currentTaskId=task?.id||null;
  currentCheckId=task?.checks?.some(c=>c.id===hash.get('check'))?hash.get('check'):null;
  hoveredTaskId=null;
  panel.hidden=!task;
  if(!task)panelExpanded=false;
  document.body.classList.toggle('has-detail',Boolean(task));
  document.body.classList.toggle('detail-expanded',Boolean(task)&&panelExpanded);
  if(chartFullscreen&&view!=='overview'){resetChartFullscreen();releaseNativeFullscreen();}
  render();
  if(task)openTask(task.id,currentCheckId,{navigate:false,reveal:!position});
  else {q('#detail').innerHTML='';applyPanelMode();}
  requestAnimationFrame(()=>{
    if(epoch!==navigationEpoch)return;
    if(position){
      const scroller=q('.board-scroll');if(scroller){scroller.scrollLeft=position.left;scroller.scrollTop=position.top;}
      const runs=q('#task-runs'),toggle=q('.run-history-toggle');
      if(runs&&toggle){runs.hidden=!position.runs;toggle.setAttribute('aria-expanded',String(Boolean(position.runs)));}
      panel.scrollTop=position.detail;window.scrollTo(position.x,position.y);
    }
    if(searchOpen)q('#search-field')?.focus({preventScroll:true});
    else if(!task){
      if(closedSearch)focusAfterSearch();
      else (location.hash==='#main'?q('#main'):q(`[data-view="${view}"]`))?.focus({preventScroll:true});
    }
    restoringNavigation=false;rememberPosition();drawDependencies();
  });
}
document.addEventListener('scroll',rememberPosition,true);
window.addEventListener('pagehide',()=>{
  rememberPosition();
  history.replaceState({...history.state,sumiBoard:{key:navigationKey,position:navigationPositions.get(navigationKey)}},'');
});
function taskMatches(t,text=query) { return `${t.title} ${t.summary} ${t.owner} ${t.area} ${waitReason(t)} ${t.wait?(t.wait.resumeWhen||'')+' '+(t.wait.owner||''):''} ${(t.checks || []).map(c=>c.title).join(' ')}`.toLocaleLowerCase().includes(text.toLocaleLowerCase()); }
function available(t) { return t.try?.available && url(t.try.url); }
function key(t,c) { return `${t.id}/${c.id}`; }
function result(t,c) { return observations[key(t,c)]?.result || c.state || 'todo'; }
function userChecks(t) { return (t.checks||[]).filter(c=>c.environment!=='engineering'); }
function checks() { return (data?.tasks || []).flatMap(t=>userChecks(t).map(c=>({t,c}))); }
function resultLabel(state) { return `<span class="result-label ${Object.hasOwn(resultNames,state)?state:'todo'}">${state==='passed'?icon('check'):state==='failed'?icon('close'):state==='blocked'?icon('pause'):''}${esc(resultNames[state]||'未確認')}</span>`; }
function empty(message) { return `<div class="empty-state"><p>${esc(message)}</p>${query?'<button data-action="clear-search">検索を解除する</button>':''}</div>`; }

function updateHeader() {
  if (!data) return;
  document.title=`${taskById(currentTaskId)?.title||{overview:'開発の記録',try:'いま触れる',checks:'実機で確かめる'}[view]} — Sumi Demo`;
  q('#try-count').textContent=data.tasks.filter(available).length;
  q('#check-count').textContent=checks().filter(({t,c})=>result(t,c)==='todo').length;
  q('#sync-label').textContent=`記録日時 ${date(data.updatedAt,true)} JST`;
  q('#reviewed-label').textContent=`当時の進捗確認 ${date(data.reviewedAt,true)}`;
}
function render() {
  if (!data) return;
  const boardScroll=q('.board-scroll')?.scrollLeft || 0;
  const boardTop=q('.board-scroll')?.scrollTop || 0;
  const focused=content.contains(document.activeElement)?document.activeElement:null;
  const focusData=focused?{...focused.dataset}:null;
  updateHeader();
  q('#search').placeholder=view==='checks'?'検証項目を探す':'タスクを探す';
  for(const tab of document.querySelectorAll('[data-view]')) {tab.classList.toggle('active',tab.dataset.view===view);tab.setAttribute('aria-pressed',String(tab.dataset.view===view));}
  content.innerHTML=view==='overview'?overview():view==='try'?tryView():checksView();
  spaceProseArrows(content);
  refreshTaskDetail();
  if(q('.board-scroll')){q('.board-scroll').scrollLeft=boardScroll;q('.board-scroll').scrollTop=boardTop;}
  requestAnimationFrame(drawDependencies);
  if(focusData&&panel.hidden){const replacement=[...content.querySelectorAll('button')].find(el=>Object.entries(focusData).every(([k,v])=>el.dataset[k]===v));replacement?.focus({preventScroll:true});}
}
function phaseRow(t,index) {
  const position=Math.max(0,stages.findIndex(s=>s.id===t.stage));
  const state=Object.hasOwn(statusNames,t.status)?t.status:'planned';
  return `<button class="task-row ${currentTaskId===t.id?'selected':''}" data-task="${esc(t.id)}" aria-label="${esc(t.title)}。${stages[position].label}・${statusNames[state]}。詳細を開く"><span class="task-label"><span class="task-number">${String(index+1).padStart(2,'0')}</span><span><span class="task-name">${esc(t.title)}</span><span class="task-meta">${esc(t.owner)}${t.blockers?.length?' · '+esc(t.blockers[0]):''}</span></span></span><span class="phase-track" aria-hidden="true">${stages.map((s,i)=>`<span class="phase-cell ${i<position?'past':i===position?'current '+state:'future'}"><span class="phase-segment">${i===position?(state==='done'?icon('check'):esc(statusNames[state])):''}</span></span>`).join('')}</span><span class="row-access ${available(t)?'ready':''}">${available(t)?'開ける'+icon('external'):t.stage==='live'?'稼働中':icon('arrow')}</span></button>`;
}
function taskStatus(t) {
  if(t.status==='done')return ['done',t.stage==='live'?'利用可能':'実装・レビュー完了'];
  if(t.status==='blocked')return ['blocked','待機中'];
  if(t.status==='planned')return ['planned',activeRuns(t,data,liveSnapshot).length?'状態の記録を確認':isTaskReady(t)?'着手可能':'未着手'];
  if(t.stage==='review'||t.status==='review')return ['review','レビュー段階'];
  if(t.stage==='integrate')return ['active','統合中'];
  return ['active','実装・検証中'];
}
const isTaskReady = t => readyToStart(t,data,liveSnapshot);
const readyMark = () => `<span class="ready-mark">${icon('ready')}<span>着手可能</span></span>`;
function phaseMobileNavigation() {
  const phases=data.phases||[],i=phases.findIndex(p=>p.id===selectedPhase);
  if(i<0)return '';
  return `<div class="phase-mobile-nav"><button data-phase="${esc(phases[Math.max(0,i-1)].id)}" aria-label="前のフェーズ" ${i===0?'disabled':''}>${icon('arrow')}</button><button data-phase="${esc(phases[Math.min(phases.length-1,i+1)].id)}" aria-label="次のフェーズ" ${i===phases.length-1?'disabled':''}>${icon('arrow')}</button></div>`;
}
function phaseOverview() {
  return `<nav class="phase-overview ${selectedPhase?'has-scope':''}" aria-label="工程で絞り込む">${(data.phases||[]).map((phase,index)=>{
    const tasks=phase.taskIds.map(taskById).filter(Boolean),done=tasks.filter(t=>t.status==='done').length;
    const workingIds=new Set(tasks.filter(t=>activeRuns(t,data,liveSnapshot).length).map(t=>t.id));
    const readyCount=tasks.filter(isTaskReady).length;
    const running=workingIds.size>0;
    const summary=`${done} / ${tasks.length} 件確認済み${running?`、${workingIds.size} 件でエージェントが作業中`:''}`;
    return `<div class="phase-choice ${selectedPhase===phase.id?'selected':''} ${phase.parallel?'parallel':''}">
      <button class="phase-select" data-phase="${esc(phase.id)}" aria-pressed="${selectedPhase===phase.id}" aria-label="${esc(phase.title)}。${summary}。このフェーズを表示"></button>
      <span class="phase-choice-heading" aria-hidden="true"><small>${phase.parallel?'並行':String(index+1).padStart(2,'0')}</small><strong>${esc(phase.title)}</strong>${running?'<span class="phase-working"><span class="work-signal"><i></i><i></i><i></i></span></span>':''}</span>
      <span class="phase-progress" role="group" aria-label="${esc(phase.title)}のタスク。${summary}">${tasks.map(t=>{
        const label=`${t.title}：${taskStatus(t)[1]}${workingIds.has(t.id)?'・エージェントが作業中':''}`;
        return `<button class="phase-progress-task" data-task="${esc(t.id)}" data-progress-task="${esc(t.id)}" aria-label="${esc(label)}。詳細を開く" ${t.id===currentTaskId?'aria-current="true"':''} title="${esc(label)}"><i aria-hidden="true" class="${taskStatus(t)[0]}${workingIds.has(t.id)?' is-working':''}"></i></button>`;
      }).join('')}</span>
      <span class="phase-choice-footer" aria-hidden="true"><span class="phase-choice-count">${done}<span> / ${tasks.length} 件確認済み</span></span>${readyCount?`<span class="phase-ready">${icon('ready')}着手可能 ${readyCount}</span>`:''}</span>
    </div>`;
  }).join('')}${phaseMobileNavigation()}</nav>`;
}
function chartControls(tasks,plan) {
  const completed=tasks.filter(t=>t.status==='done').length;
  const phase=data.phases?.find(p=>p.id===selectedPhase);
  return `<div class="plan-toolbar"><div class="plan-summary"><button class="all-phases ${!phase?'selected':''}" data-phase="" aria-pressed="${!phase}">全体</button>${phase?`<span class="scope-divider">/</span><span>${esc(phase.title)}</span>`:''}${chartFullscreen?`<span class="fullscreen-phase-controls">${selectedPhase?phaseMobileNavigation():'<button data-phase="foundation">フェーズ別</button>'}</span>`:''}<span class="plan-count">${completed}<span> / ${tasks.length} 件</span></span></div><div class="plan-tools"><div class="plan-legend" aria-label="状態の色">${[['active','進行中'],['review','レビュー'],['blocked','待機'],['done','確認済み']].map(([state,label])=>`<span><i class="status-swatch ${state}"></i>${label}</span>`).join('')}</div><button class="dependency-toggle ${showDependencies?'active':''}" data-action="dependencies" aria-pressed="${showDependencies}">${icon('link')}依存関係</button><button class="chart-fullscreen-button" data-action="fullscreen-chart" aria-label="${chartFullscreen?'チャートの全画面表示を終了':'チャートだけ全画面表示'}" title="${chartFullscreen?'全画面表示を終了':'チャートだけ全画面表示'}">${icon(chartFullscreen?'shrink':'expand')}</button></div></div>`;
}
function sectionHeading(label) {
  return `<h3 class="section-heading"><span>${esc(label)}</span></h3>`;
}
function planConnections(t,plan,compact=false) {
  const n=plan.nodes.get(t.id), upstream=(t.dependencies||[]).map(taskById).filter(Boolean);
  const downstream=data.tasks.filter(next=>(next.dependencies||[]).includes(t.id)&&next.status!=='done');
  const relation=(item,direction)=>{const node=plan.nodes.get(item.id),phase=data.phases?.find(p=>p.taskIds.includes(item.id));return `<button class="relation-link ${node.complete?'satisfied':'pending'}" data-task="${esc(item.id)}"><span class="relation-indicator">${node.complete?icon('check'):icon('arrow')}</span><span><strong>${esc(item.title)}</strong><small>${node.complete?'確認済み':esc(taskStatus(item)[1])}${phase?' · '+esc(phase.title):''}</small></span></button>`;};
  if(compact)return `<div class="relation-summary">${isTaskReady(t)?`<div class="readiness-summary">${readyMark()}<span>${upstream.length?'前提の作業はすべて確認済みです。':'前提となる作業はありません。'}まだ着手していません。</span></div>`:''}${n.waiting.length?`<span>未完了の前提 ${n.waiting.length} 件</span>`:''}${n.unlocks.length?`<span>完了すると、後続 ${n.unlocks.length} 件の前提が揃います。</span>`:''}</div>`;
  return `<section class="detail-section relations-section">${sectionHeading('依存関係')}${planConnections(t,plan,true)}${upstream.length?`<div class="relation-group"><p class="relation-heading">前提の作業</p><div class="relation-items">${upstream.map(item=>relation(item,'up')).join('')}</div></div>`:''}${downstream.length?`<div class="relation-group"><p class="relation-heading">後続の作業</p><div class="relation-items">${downstream.map(item=>relation(item,'down')).join('')}</div></div>`:''}${!upstream.length&&!downstream.length?'<p class="test-note">他のタスクと並行して進められます。</p>':''}</section>`;
}
function visibleColumns(tasks,plan) {
  return [...new Set([0,1,2,...tasks.map(t=>plan.nodes.get(t.id).level)])].sort((a,b)=>a-b);
}
function activityMark(runs) {
  return runs.length ? `<span class="work-signal" aria-hidden="true"><i></i><i></i><i></i></span><span>作業中${runs.length>1?' · '+runs.length+'件':''}</span>` : '';
}
function retryLabel(t) {
  const r=t.operational?.retry;if(!r)return '';
  const at=Date.parse(r.retryAt);
  if(r.state==='scheduled')return Number.isFinite(at)?(at>Date.now()?`再開予定 ${time(r.retryAt)}`:'再開の確認待ち'):'再開時刻を確認中';
  if(['launching','started'].includes(r.state))return '再開の起動を確認中';
  if(['failed','exhausted','needs-session','attention','launch-lost'].includes(r.state))return '再開には対応が必要';
  return '';
}
function retryDetail(t) {
  const r=t.operational?.retry,label=retryLabel(t);if(!r||!label)return '';
  const valid=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
  const count=Number.isInteger(r.attempts)&&Number.isInteger(r.maxAttempts)?`自動再開 ${r.attempts} / ${r.maxAttempts} 回`:'';
  return `<div class="retry-detail" role="status"><p>${esc(label)}</p><small>Devin のメッセージ送信頻度の制限で停止しました。${valid(r.resetAt)?`${esc(date(r.resetAt,true))} 以降に制限の解除見込み。`:''}${count?' '+esc(count)+'。':''}</small></div>`;
}
function waitReason(t) {
  if(t.status!=='blocked'&&!(t.status==='planned'&&t.wait))return '';
  const reason=typeof t.wait?.reason==='string'?t.wait.reason.trim():'';
  return reason||(Array.isArray(t.blockers)?t.blockers:[]).filter(b=>typeof b==='string'&&b.trim()).join(' / ')||'待機理由が未登録です';
}
function waitingDetail(t) {
  if(t.status!=='blocked'&&!(t.status==='planned'&&t.wait))return '';
  const w=t.wait||{}, present=v=>typeof v==='string'&&v.trim();
  const validTime=v=>present(v)&&Number.isFinite(Date.parse(v));
  const incomplete=!['decision','dependency','capacity','rate-limit','external'].includes(w.kind)||!present(w.reason)||!present(w.owner)||!present(w.resumeWhen)||!validTime(w.since)||!validTime(w.reviewAfter);
  const overdue=validTime(w.reviewAfter)&&Date.parse(w.reviewAfter)<=Date.now();
  const running=activeRuns(t,data,liveSnapshot).length>0;
  const issue=running?'実行中の記録があります。待機状態との食い違いを確認します。':incomplete?'待機の記録が不足しています。調整担当が理由と再開条件を確認します。':overdue?'再確認の予定時刻を過ぎています。調整担当が待機を続ける必要があるか確認します。':'';
  return `<section class="waiting-detail" aria-label="待機理由">${sectionHeading('待機理由')}<p class="wait-reason">${esc(waitReason(t))}</p><dl class="wait-facts"><div><dt>再開条件</dt><dd>${esc(present(w.resumeWhen)?w.resumeWhen:'未登録')}</dd></div><div><dt>対応者</dt><dd>${esc(present(w.owner)?w.owner:'未登録')}</dd></div></dl>${issue?`<p class="wait-attention">${esc(issue)}</p>`:''}<p class="wait-timing">${validTime(w.since)?`${date(w.since,true)} から待機`:''}${validTime(w.since)&&validTime(w.reviewAfter)?' · ':''}${validTime(w.reviewAfter)?`${date(w.reviewAfter,true)} に再確認`:''}</p></section>`;
}
function gantt(tasks,groups,plan) {
  const flow=layoutFlow(tasks);
  return `<div class="board-scroll plan-scroll flow-scroll" tabindex="0" role="region" aria-label="タスクの進行順と依存関係"><div class="plan-board flow-board" style="--flow-columns:${flow.columns};--plan-columns:${flow.columns}" data-show-dependencies="${showDependencies}"><div class="plan-head flow-head"><div class="flow-axis">${Array.from({length:flow.columns},(_,i)=>`<span>${String(i+1).padStart(2,'0')}${i===0?'<small>進行順</small>':''}</span>`).join('')}</div></div><svg class="plan-dependencies" aria-hidden="true"></svg>${flow.groups.map(group=>`<section class="flow-section"><div class="plan-group"><span>${esc(group.area)}</span><span>${group.tasks.length} 件</span></div><div class="flow-grid">${group.tasks.map(t=>{
    const node=flow.nodes.get(t.id),n=plan.nodes.get(t.id),[state,label]=taskStatus(t),runs=activeRuns(t,data,liveSnapshot);
    const waiting=(t.dependencies||[]).map(taskById).filter(p=>p&&p.status!=='done');
    const outside=waiting.filter(p=>!flow.nodes.has(p.id));
    const short={active:t.stage==='integrate'?'統合中':'進行中',review:'レビュー',blocked:'待機',done:t.stage==='live'?'利用可能':'確認済み',planned:label}[state];
    const note=n.invalid?'依存関係を確認':t.status==='done'&&t.stage!=='live'?'未公開':outside.length?`別フェーズの前提 ${outside.length} 件`:waiting.length?`前提 ${waiting.length} 件`:'';
    return `<button class="plan-task flow-task ${currentTaskId===t.id?'selected':''} ${runs.length?'is-running':''} ${isTaskReady(t)?'is-ready':''}" data-task="${esc(t.id)}" data-flow-col="${node.col}" data-flow-row="${node.row}" style="grid-column:${node.col+1};grid-row:${node.row+1}" aria-controls="task-panel" aria-expanded="${currentTaskId===t.id}" aria-label="${esc(t.title)}。${label}${runs.length?'。エージェントが作業中':''}。詳細を開く"><span class="task-bar ${state}"><span class="flow-title">${esc(t.title)}</span><span class="flow-meta">${isTaskReady(t)?readyMark():`<span class="flow-status"><i class="status-swatch ${state}"></i>${short}</span>`}${runs.length?`<span class="flow-activity">${activityMark(runs)}</span>`:retryLabel(t)?`<span class="flow-retry">${esc(retryLabel(t))}</span>`:note?`<span class="flow-note">${esc(note)}</span>`:''}</span>${state==='blocked'||(state==='planned'&&t.wait)?`<span class="flow-wait-reason">${esc(waitReason(t))}</span>`:''}${waiting.length?`<span class="mobile-relation"><small>前提</small><span>${esc(waiting[0].title)}${waiting.length>1?' ほか '+(waiting.length-1)+' 件':''}</span></span>`:''}</span></button>`;
  }).join('')}</div></section>`).join('')}</div></div><div class="plan-reading"><span>左から右へ進む順。分岐は別の行、矢印の先で合流します。</span><span>帯の幅は作業時間を表しません。</span></div>`;
}
function drawDependencies() {
  const board=q('.plan-board'),svg=q('.plan-dependencies');if(!board||!svg)return;
  const rect=board.getBoundingClientRect(),rows=[...board.querySelectorAll('.plan-task')];
  svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);svg.style.height=rect.height+'px';
  const connections=[];let focusId=hoveredTaskId||currentTaskId;
  for(const target of rows){const t=taskById(target.dataset.task);for(const id of t.dependencies||[]){const source=rows.find(r=>r.dataset.task===id);if(!source)continue;connections.push({id:id+'>'+t.id,source,target,related:focusId===id||focusId===t.id,satisfied:taskById(id)?.status==='done'});}}
  if(!connections.some(c=>c.related))focusId=null;
  const activeIds=new Set([focusId]);for(const c of connections)if(c.related){activeIds.add(c.source.dataset.task);activeIds.add(c.target.dataset.task);}
  for(const row of rows){const selected=row.dataset.task===currentTaskId;row.classList.toggle('selected',selected);row.setAttribute('aria-expanded',String(selected));row.classList.toggle('related',Boolean(focusId&&activeIds.has(row.dataset.task)));row.classList.toggle('unrelated',Boolean(focusId&&!activeIds.has(row.dataset.task)));}
  if(!showDependencies||(!chartFullscreen&&matchMedia('(max-width:600px)').matches)){svg.innerHTML='';return;}
  const anchor=el=>{const title=el.querySelector('.flow-title');return title.getBoundingClientRect().top+parseFloat(getComputedStyle(title).lineHeight)/2;};
  const geometries=connections.map(c=>({c,source:c.source.getBoundingClientRect(),target:c.target.getBoundingClientRect(),sourceY:anchor(c.source),targetY:anchor(c.target)}));
  const incoming=new Map(),outgoing=new Map();
  for(const g of geometries){for(const [map,id] of [[incoming,g.c.target.dataset.task],[outgoing,g.c.source.dataset.task]]){if(!map.has(id))map.set(id,[]);map.get(id).push(g);}}
  for(const group of incoming.values())group.sort((a,b)=>Math.abs(a.sourceY-a.targetY)-Math.abs(b.sourceY-b.targetY));
  const incomingPort=g=>{
    const group=incoming.get(g.c.target.dataset.task),i=group.indexOf(g);if(!i)return 0;
    const below=g.sourceY>=g.targetY,peers=group.slice(1,i+1).filter(p=>(p.sourceY>=p.targetY)===below).length;
    const available=below?g.target.bottom-g.targetY-8:g.targetY-g.target.top-6;
    const total=group.slice(1).filter(p=>(p.sourceY>=p.targetY)===below).length;
    return (below?1:-1)*peers*Math.min(8,Math.max(1,available)/total);
  };
  const boxes=rows.map(row=>{const r=row.getBoundingClientRect();return{id:row.dataset.task,left:r.left-rect.left,right:r.right-rect.left,top:r.top-rect.top,bottom:r.bottom-rect.top};});
  const geometryKey=JSON.stringify([boxes,geometries.map(g=>[g.c.id,g.sourceY-rect.top,g.targetY-rect.top])]);
  if(routeCache.key!==geometryKey){
    const paths=new Map();
    const bendPositions=new Map();
    // Nest incoming turns: the farther source uses the lane nearer the target.
    // This keeps a lower source's vertical leg out of a nearer source's approach.
    for(const group of incoming.values()){
      for(const direction of [-1,1]){
        const peers=group.filter(g=>(g.sourceY-g.targetY)*direction>1);
        if(peers.length<2)continue;
        const targetLeft=peers[0].target.left-rect.left;
        const previousRight=Math.max(0,...boxes.filter(b=>b.right<targetLeft-1).map(b=>b.right));
        const right=targetLeft-14,left=previousRight+10;
        if(right<=left)continue;
        const spacing=Math.min(10,(right-left)/(peers.length-1));
        peers.forEach((g,i)=>bendPositions.set(g.c.id,right-(peers.length-1-i)*spacing));
      }
    }
    for(const g of geometries){const {c,source,target}=g;
      const start=[source.right-rect.left+1,g.sourceY-rect.top],end=[target.left-rect.left-4,g.targetY-rect.top+incomingPort(g)];
      const obstacles=boxes.filter(b=>b.id!==c.source.dataset.task&&b.id!==c.target.dataset.task);
      const points=orthogonalRoute(start,end,obstacles,bendPositions.get(c.id));
      if(points)paths.set(c.id,points);
    }
    routeCache={key:geometryKey,paths};
  }
  svg.innerHTML='<defs><marker id="plan-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 7 4 1 7" fill="none" stroke="#92969b" stroke-width="1.35"/></marker><marker id="plan-arrow-active" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 7 4 1 7" fill="none" stroke="#454545" stroke-width="1.5"/></marker></defs>'+geometries.map(g=>{
    const c=g.c,points=routeCache.paths.get(c.id);if(!points)return '';
    return `<path class="plan-arrow ${c.related?'highlight':''} ${c.satisfied?'satisfied':''} ${focusId&&!c.related?'muted':''}" data-connection="${esc(c.id)}" d="${routePath(points)}" marker-end="url(#${c.related?'plan-arrow-active':'plan-arrow'})"/>`;
  }).join('');
}
function planningInsights(plan) {
  const ready=data.tasks.filter(isTaskReady);
  const bottlenecks=data.tasks.filter(t=>t.status!=='done'&&plan.nodes.get(t.id).unlocks.length).sort((a,b)=>plan.nodes.get(b.id).downstream.length-plan.nodes.get(a.id).downstream.length);
  if(!ready.length&&!bottlenecks.length)return '';
  return `<div class="planning-insights">${bottlenecks.slice(0,2).map(t=>`<button data-task="${esc(t.id)}"><span class="insight-label">先に完了すると</span><span>${esc(t.title)}</span><strong>後続 ${plan.nodes.get(t.id).unlocks.length} 件の前提が揃う</strong>${icon('arrow')}</button>`).join('')}${ready.length?`<button data-task="${esc(ready[0].id)}"><span class="insight-label">着手可能なタスク</span><span>${esc(ready[0].title)}</span>${ready.length>1?`<strong>ほか ${ready.length-1} 件</strong>`:''}${icon('arrow')}</button>`:''}</div>`;
}
function overview() {
  const phase=data.phases?.find(p=>p.id===selectedPhase);
  const tasks=data.tasks.filter(t=>taskMatches(t)&&(!phase||phase.taskIds.includes(t.id))),groups=[...new Set(tasks.map(t=>t.area||'開発'))],plan=buildPlan(data.tasks);
  return `${phaseOverview()}<div class="overview-layout"><div class="chart-workspace">${chartControls(tasks,plan)}${chartFullscreen?'<p class="rotate-hint">端末を横向きにすると、チャートを広く表示できます。</p>':''}${tasks.length?gantt(tasks,groups,plan):empty('該当するタスクがありません。')}${planningInsights(plan)}</div></div>`;
}

function activity() {
  const events=(data.activity||[]).filter(a=>!query||!a.taskId||taskMatches(taskById(a.taskId)||{title:a.title})).slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,6);
  return `<section class="activity-section"><div class="section-heading"><h2>作業の動き</h2><span>返答の到着 → 確認 → 進捗へ反映</span></div>${data.workers?.length?`<div class="worker-list">${data.workers.map(w=>`<span class="worker-item"><i class="worker-dot ${['running','finished'].includes(w.status)?w.status:''}"></i>${esc(w.label)}<span>${esc(workerNames[w.status] || w.status)}</span></span>`).join('')}</div>`:''}<ol class="activity-list">${events.map(a=>`<li class="activity-item"><time class="activity-time" datetime="${esc(a.at)}" title="${esc(date(a.at,true))}">${date(a.at)}<br>${time(a.at)}</time><div>${taskById(a.taskId)?`<button data-task="${esc(a.taskId)}">${esc(a.title)}</button>`:esc(a.title)}<p>${esc(a.detail)}</p></div></li>`).join('')||'<li class="aside-note">記録された更新はまだありません。</li>'}</ol></section>`;
}
function tryView() {
  const ready=data.tasks.filter(t=>available(t)&&taskMatches(t)), other=data.tasks.filter(t=>!available(t)&&taskMatches(t)&&t.stage!=='live');
  return `<div class="view-intro"><div><h2>利用できる画面</h2><p>開ける場所と、その画面で確かめられる範囲。<br>タスクの詳細から、確認手順とこれまでの結果も見られます。</p></div></div>${ready.length?`<div class="try-list">${ready.map((t,i)=>`<article class="try-item"><span class="try-index">${String(i+1).padStart(2,'0')}</span><div><h3>${esc(t.try.label||t.title)}</h3><p>${esc(t.try.note||t.summary)}</p><div class="try-meta"><span class="env-label">${icon('monitor')}${esc(t.try.environment)}</span><button class="text-button" data-task="${esc(t.id)}">範囲と検証手順${icon('arrow')}</button></div></div><div class="try-actions">${external(t.try.url,'画面を開く','button')}</div></article>`).join('')}</div>`:empty('いま開ける画面に、該当するものがありません。')}<section class="not-yet"><h3>まだ、公開版で触れないもの</h3>${other.map(t=>`<div class="not-yet-item"><button data-task="${esc(t.id)}">${esc(t.title)}</button><span>${esc(stages.find(s=>s.id===t.stage)?.label||'準備中')} · ${esc(statusNames[t.status]||'準備中')}</span></div>`).join('')||'<p class="aside-note">該当する項目はありません。</p>'}</section>`;
}
function checksView() {
  const all=checks().filter(({t,c})=>taskMatches(t)||c.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const list=all.filter(({t,c})=>checkFilter==='all'||result(t,c)===checkFilter);
  return `<div class="view-intro"><div><h2>実機で確認すること</h2><p>手順を開いて、使ってみた結果を残せます。<br>開発側の確認済み情報に、あなたの手元での確認を重ねていく場所です。</p><p class="local-hint">あなたの記録はこのブラウザだけに保存されます。開発側へ共有するときは「記録を書き出す」から。</p></div><button class="button outline" data-action="export">${icon('download')}記録を書き出す</button></div><div class="checks-toolbar" aria-label="確認状況で絞り込む">${[['todo','未確認'],['failed','うまくいかない'],['blocked','まだ試せない'],['passed','確認できた'],['all','すべて']].map(([id,label])=>`<button class="filter-button ${checkFilter===id?'active':''}" data-filter="${id}" aria-pressed="${checkFilter===id}">${label} <span>${all.filter(({t,c})=>id==='all'||result(t,c)===id).length}</span></button>`).join('')}</div>${list.length?`<div class="verification-list">${list.map(({t,c})=>{const own=observations[key(t,c)];return `<article class="verification-item"><div class="verification-meta"><span>${esc(c.environment)}</span><span>${esc(t.title)}</span></div><button class="open-check" data-task="${esc(t.id)}" data-check="${esc(c.id)}"><h3>${esc(c.title)}</h3><p>${esc(c.expected)}</p></button><div class="verification-result">${resultLabel(result(t,c))}<small>${own?.result?'あなたの記録':c.state==='passed'?'開発側の確認記録':'未記録'}${own?.at?' · '+time(own.at):''}</small><button class="text-button" data-task="${esc(t.id)}" data-check="${esc(c.id)}">手順を開く${icon('arrow')}</button></div></article>`}).join('')}</div>`:empty(checkFilter==='todo'?'未確認の項目はありません。ほかの確認状況も切り替えて見られます。':'この確認状況に該当する項目はありません。')}`;
}
function testBlock(t,c) {
  const own=observations[key(t,c)] || {};
  return `<section class="test-block" id="check-${esc(c.id)}" data-check-block="${esc(c.id)}"><div class="test-title"><div><h4>${esc(c.title)}</h4><small>${esc(c.environment)}</small></div>${resultLabel(result(t,c))}</div>${c.url?external(c.url,'検証する画面を開く','text-button'):''}<ol class="test-steps">${(c.steps||[]).map(s=>`<li>${esc(s)}</li>`).join('')}</ol><p class="expected"><small>確認したいこと</small>${esc(c.expected)}</p>${c.note?`<p class="test-note">${esc(c.note)}</p>`:''}<span class="record-label">あなたの手元での結果 · このブラウザに保存</span><div class="test-options">${[['passed','check'],['failed','close'],['blocked','pause']].map(([r,i])=>`<button class="test-option" data-result="${r}" data-check-id="${esc(c.id)}" aria-pressed="${own.result===r}">${icon(i)}${resultNames[r]}</button>`).join('')}</div><label class="sr-only" for="note-${esc(c.id)}">${esc(c.title)}の検証メモ</label><textarea class="test-textarea" id="note-${esc(c.id)}" data-note="${esc(c.id)}" placeholder="端末・ブラウザ、気づいたことをひと言。">${esc(own.note||'')}</textarea><div class="record-bottom"><span data-save-state="${esc(c.id)}">${own.at?'個人メモ保存済み · '+esc(date(own.at,true)):'入力すると自動で保存されます'}</span><button data-clear-check="${esc(c.id)}">個人メモを消す</button></div></section>`;
}
function runHistory(t) {
  const intervals=t.intervals||[];
  if(!intervals.length)return '';
  const kinds={work:'実装',review:'レビュー',integration:'統合・運用'};
  return `<section class="detail-section run-history"><button class="run-history-toggle" data-action="runs" aria-expanded="false" aria-controls="task-runs">実行の記録 <span>${intervals.length} 件</span>${icon('arrow')}</button><div id="task-runs" hidden><p class="test-note">実際の実行時間です。タスクの完了や作業量は表しません。</p>${intervals.slice().reverse().map(i=>`<div class="run-history-row"><span>${esc(kinds[i.kind]||'作業')} · ${esc(workerNames[i.status]||'状態未確認')}</span><time>${esc(date(i.start,true))} → ${i.end?esc(time(i.end)):i.status==='running'?'実行中':'終了時刻不明'}</time></div>`).join('')}</div></section>`;
}
function taskNavigation(t) {
  const phase=data.phases?.find(p=>p.id===selectedPhase);
  let list=data.tasks.filter(item=>taskMatches(item)&&(!phase||phase.taskIds.includes(item.id)));
  if(!list.some(item=>item.id===t.id))list=data.tasks;
  const i=list.findIndex(item=>item.id===t.id),prev=list[i-1],next=list[i+1];
  return `<nav class="mobile-task-nav" aria-label="前後のタスク"><button ${prev?`data-task="${esc(prev.id)}"`:'disabled'} aria-label="前のタスク">${icon('arrow')}<span>前のタスク<small>${esc(prev?.title||'最初のタスク')}</small></span></button><span class="mobile-task-count">${i+1} / ${list.length}</span><button ${next?`data-task="${esc(next.id)}"`:'disabled'} aria-label="次のタスク"><span>次のタスク<small>${esc(next?.title||'最後のタスク')}</small></span>${icon('arrow')}</button></nav>`;
}
function applyPanelMode() {
  const sideBySide=matchMedia('(orientation:landscape) and (min-width:560px) and (max-height:600px)').matches;
  const focused=!panel.hidden&&(panelExpanded||(matchMedia('(max-width:600px)').matches&&!sideBySide));
  q('main').inert=focused||searchOpen;document.body.style.overflow=focused||chartFullscreen||searchOpen?'hidden':'';
  panel.setAttribute('role',focused?'dialog':'complementary');
  if(focused)panel.setAttribute('aria-modal','true');else panel.removeAttribute('aria-modal');
}
function actorName(run) {
  const models={'swe-2-high':'SWE-2 High','swe-2-max':'SWE-2 Max','swe-2-medium':'SWE-2 Medium','claude-fable-5-1':'Fable 5.1','claude-opus-5':'Opus 5'};
  if(run.model)return models[run.model]||run.model;
  const worker=data.workers?.find(w=>w.id===run.id);
  if(worker?.label)return worker.label;
  return {devin:'Devin · モデル未記録',claude:'Claude · モデル未記録'}[run.engine]||'担当モデル未記録';
}
function agentPresence(t) {
  const age=0,fresh=liveSnapshot;
  const current=activeRuns(t,data,liveSnapshot),history=(t.intervals||[]).slice().sort((a,b)=>Date.parse(b.start)-Date.parse(a.start));
  const reviews=current.filter(r=>r.kind==='review');
  const roles={review:'レビュー',integration:'統合・運用',work:'実装・検証'};
  const status=run=>run.status==='running'?'稼働中':workerNames[run.status]||'状態未確認';
  const reviewOwner=t.reviewOwner||[...new Set(reviews.map(actorName))].join(' / ');
  const showReview=t.stage==='review'||t.reviewOwner||reviews.length;
  const timeStamp=value=>!Number.isFinite(Date.parse(value))?'時刻未記録':new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value));
  const checked=Number.isFinite(Date.parse(data.updatedAt))?timeStamp(data.updatedAt):'時刻未記録';
  const recent=history.filter(r=>r.status!=='running').slice(0,2);
  return `<section class="agent-presence" id="agent-presence" aria-label="担当者と実行状況"><div class="agent-presence-heading">${sectionHeading('エージェントの実行')}<small>当時の最終確認 ${esc(checked)}</small></div>${showReview?`<div class="agent-assignment"><span>レビュー担当</span><strong>${esc(reviewOwner||'担当の記録なし')}</strong></div>`:''}${!fresh?'<p class="agent-idle">接続の回復後に、稼働状況を確認します。</p>':current.length?`<div class="agent-live-list">${current.map(run=>`<div class="agent-run"><span class="agent-run-role">${esc(roles[run.kind]||'作業')}</span><strong>${esc(actorName(run))}</strong><span class="agent-running"><span class="work-signal" aria-hidden="true"><i></i><i></i><i></i></span>当時稼働中</span><small>${run.start?esc(time(run.start))+' 開始':''}${run.observedAt?' · '+esc(timeStamp(run.observedAt))+' 確認':''}</small></div>`).join('')}</div>`:'<p class="agent-idle">この時点で稼働中の実行は記録されていません。</p>'}${recent.length?`<div class="agent-recent"><span class="agent-recent-label">直近の実行</span>${recent.map(run=>`<div class="agent-run past"><span class="agent-run-role">${esc(roles[run.kind]||'作業')}</span><strong>${esc(actorName(run))}</strong><span class="agent-terminal ${run.status==='finished'?'returned':''}">${esc(status(run))}</span><small>${esc(time(run.end||run.observedAt||run.start))}${run.end?' 終了':' 確認'}<span class="agent-run-id">${esc(run.id)}</span></small></div>`).join('')}</div>`:''}<p class="agent-observation-note">2026年9月17日 07:16 JST 時点の実行記録です。現在の稼働状況ではありません。</p></section>`;
}
function operationalStatus(t) {
  const op=t.operational;
  if(!op)return '<div class="operational-status" hidden></div>';
  const fresh=record=>{
    const age=Date.parse(data.updatedAt)-Date.parse(record?.observedAt),snapshotAge=0;
    return liveSnapshot&&!record?.stale&&!record?.error&&Number.isFinite(age)&&age>=-60000&&age<=180000&&snapshotAge>=-60000&&snapshotAge<=180000;
  };
  const stamp=record=>record.observedAt?`${date(record.observedAt,true)} 確認`:'確認記録なし';
  const prs=(op.prs||[]).map(pr=>{
    const current=fresh(pr),states={open:'未統合',merged:'統合済み',closed:'クローズ',missing:'見つかりません',unknown:'状態未確認'};
    const checks=pr.checks||{},total=Number(checks.total)||0;
    const result=['missing','unknown'].includes(pr.state)?'未確認':checks.failed?`${checks.failed} 件失敗`:checks.pending?`${checks.pending} 件実行待ち・実行中`:total?`${checks.passed} / ${total} 件成功`:'チェック未登録';
    const failures=(checks.items||[]).filter(c=>['FAILURE','ERROR','TIMED_OUT','CANCELLED','ACTION_REQUIRED'].includes(c.conclusion));
    return `<div class="operational-pr"><div class="operational-row">${external(pr.url,`PR #${pr.number}`)}<span>${esc(states[pr.state]||'状態未確認')}${current?'':' · 当時の記録'}</span></div><div class="operational-result"><p class="operational-checks ${current&&checks.failed?'has-failure':''}">${pr.head?`<code>${esc(pr.head)}</code> · `:''}CI ${esc(result)}</p>${failures.map(c=>`<div class="operational-check-link">${external(c.url,c.name)}</div>`).join('')}<small>${esc(stamp(pr))}${current?'':' · この時点の記録'}</small></div></div>`;
  }).join('');
  const issue=op.issue,assignment=op.assignment;
  return `<section class="operational-status detail-section" aria-label="開発作業との同期">${sectionHeading('コードの統合・自動検証')}${prs}${issue?`<div class="operational-row">${external(issue.url,`Issue #${issue.number}`)}<span>${esc({open:'オープン',closed:'クローズ',missing:'見つかりません',unknown:'状態未確認'}[issue.state]||'状態未確認')}${fresh(issue)?'':' · この時点の記録'}</span></div>`:''}${assignment?.owner?`<p class="operational-assignment">タスクの担当 · ${esc(assignment.owner)}<small>${assignment.state==='claimed'&&assignment.leaseLive&&fresh(assignment)?'引き受け中':'当時の担当記録'}</small></p>`:''}</section>`;
}
function refreshTaskDetail() {
  const task=taskById(currentTaskId),region=q('#agent-presence');
  if(!task||panel.hidden||!region)return;
  // Refresh editorial and progress fields without rebuilding the user's note inputs.
  const fragment=document.createElement('template');fragment.innerHTML=detail(task);spaceProseArrows(fragment.content);
  for(const selector of ['#detail-title','.detail-kicker','.detail-summary']){
    const current=panel.querySelector(selector),next=fragment.content.querySelector(selector);
    if(current&&next&&current.innerHTML!==next.innerHTML)current.innerHTML=next.innerHTML;
  }
  for(const selector of ['.detail-stages','.next-step','.relations-section','.operational-status']){
    const current=panel.querySelector(selector),next=fragment.content.querySelector(selector);
    if(current&&next&&current.outerHTML!==next.outerHTML){
      const focusTask=current.contains(document.activeElement)?document.activeElement.dataset.task:null;
      current.replaceWith(next);
      if(focusTask)[...next.querySelectorAll('[data-task]')].find(el=>el.dataset.task===focusTask)?.focus({preventScroll:true});
    }else if(current&&!next)current.remove();
    else if(!current&&next&&selector==='.next-step')region.before(next);
  }
  region.outerHTML=agentPresence(task);
  const runs=q('.run-history');if(runs){
    const open=runs.querySelector('.run-history-toggle')?.getAttribute('aria-expanded')==='true';
    const focused=runs.contains(document.activeElement);
    runs.outerHTML=runHistory(task);
    const toggle=q('.run-history-toggle'),list=q('#task-runs');if(toggle&&list){toggle.setAttribute('aria-expanded',String(open));list.hidden=!open;if(focused)toggle.focus({preventScroll:true});}
  }
}
function detail(t) {
  const position=Math.max(0,stages.findIndex(s=>s.id===t.stage));
  return `<div class="detail-body"><div class="detail-titlebar"><button class="detail-back" data-action="close-dialog">${icon('arrow')}一覧へ</button><p class="detail-kicker">${esc(t.area)} / ${esc(t.owner)}</p><div class="detail-tools"><button class="icon-button" data-action="expand-panel" aria-label="${panelExpanded?'一覧と並べて表示':'詳細を大きく表示'}">${icon(panelExpanded?'shrink':'expand')}</button><button class="icon-button" data-action="copy-link" aria-label="このタスクへのリンクをコピー" title="リンクをコピー">${icon('link')}</button><button class="icon-button" data-action="close-dialog" aria-label="詳細を閉じる">${icon('close')}</button></div></div><h2 id="detail-title" tabindex="-1">${esc(t.title)}</h2><p class="detail-summary">${esc(t.summary)}</p><div class="detail-stages" aria-label="${esc(stages[position].label)}・${esc(statusNames[t.status]||'準備中')}">${stages.map((s,i)=>`<span class="detail-stage ${i<position?'past':i===position?'current '+taskStatus(t)[0]:''}">${s.label}</span>`).join('')}</div>${available(t)?`${external(t.try.url,t.try.label||'画面を開く','button')}<p class="test-note">${esc(t.try.environment)} · ${esc(t.try.note||'')}</p>`:''}${retryDetail(t)}${waitingDetail(t)}${t.next||(t.status!=='blocked'&&t.blockers?.length)?`<div class="next-step">${sectionHeading('次に必要なこと')}${t.next?`<p>${esc(t.next)}</p>`:''}${(t.status==='blocked'?[]:t.blockers||[]).map(b=>`<p class="waiting-reason">${esc(b)}</p>`).join('')}</div>`:''}${agentPresence(t)}${operationalStatus(t)}${planConnections(t,buildPlan(data.tasks))}${userChecks(t).length?`<section class="detail-section">${sectionHeading('実機での確認')}${userChecks(t).map(c=>testBlock(t,c)).join('')}</section>`:''}${t.evidence?.length?`<section class="detail-section">${sectionHeading('できたことと、確認の根拠')}${t.evidence.map(e=>`<div class="evidence-item">${e.url?external(e.url,e.label):`<span>${esc(e.label)}</span>`}<p>${esc(e.detail)}</p>${e.verifiedAt?`<time datetime="${esc(e.verifiedAt)}">${date(e.verifiedAt,true)} 確認</time>`:''}</div>`).join('')}</section>`:''}${runHistory(t)}${t.history?.length?`<section class="detail-section">${sectionHeading('ここまでの経過')}<ol class="history">${t.history.map(h=>`<li><time datetime="${esc(h.at||'')}">${h.at?date(h.at,true):'日時未記録'}</time><span>${esc(h.label)}</span></li>`).join('')}</ol></section>`:''}</div>${taskNavigation(t)}`;
}
function nativeFullscreenElement() { try{return document.fullscreenElement||document.webkitFullscreenElement||null;}catch{return null;} }
function releaseNativeFullscreen() {
  // Best effort: layout never waits on the native exit promise, which can
  // hang or be missing in embedded browsers.
  if(nativeFullscreenElement()!==document.documentElement)return;
  const exit=document.exitFullscreen||document.webkitExitFullscreen;
  try{if(exit)Promise.resolve(exit.call(document)).catch(()=>{});}catch{}
}
function resetChartFullscreen() {
  const wasFullscreen=chartFullscreen;
  fullscreenEpoch++;chartFullscreen=false;nativeFullscreenOwned=false;
  if(orientationOwned){try{screen.orientation?.unlock();}catch{}orientationOwned=false;}
  document.body.classList.remove('chart-fullscreen');applyPanelMode();
  if(wasFullscreen){
    render();
    const scroller=q('.board-scroll');
    if(scroller&&chartScrollMemory&&!scroller.scrollLeft&&!scroller.scrollTop){scroller.scrollLeft=chartScrollMemory.left;scroller.scrollTop=chartScrollMemory.top;}
    if(chartPageMemory)window.scrollTo(chartPageMemory.x,chartPageMemory.y);
    q('[data-action="fullscreen-chart"]')?.focus({preventScroll:true});
  }
}
async function toggleChartFullscreen() {
  if(chartFullscreen){resetChartFullscreen();releaseNativeFullscreen();return;}
  if(!panel.hidden){closeTask();clearPanelGhost();}
  const epoch=++fullscreenEpoch;
  chartPageMemory={x:scrollX,y:scrollY};
  chartScrollMemory={left:q('.board-scroll')?.scrollLeft||0,top:q('.board-scroll')?.scrollTop||0};
  chartFullscreen=true;document.body.classList.add('chart-fullscreen');applyPanelMode();render();
  // Native fullscreen is an enhancement over the layout class; ownership is
  // confirmed by fullscreenchange, not by the promise resolving.
  const request=document.documentElement.requestFullscreen||document.documentElement.webkitRequestFullscreen;
  try{if(request)await request.call(document.documentElement,{navigationUI:'hide'});}catch{/* Browser viewport expansion remains available without the native API. */}
  if(!chartFullscreen){releaseNativeFullscreen();return;}
  if(epoch!==fullscreenEpoch)return;
  nativeFullscreenOwned=nativeFullscreenElement()===document.documentElement;
  if(matchMedia('(pointer:coarse)').matches&&screen.orientation?.lock){
    try{await screen.orientation.lock('landscape');orientationOwned=true;if(!chartFullscreen){screen.orientation.unlock();orientationOwned=false;}}catch{/* Manual device rotation remains available. */}
  }
  requestAnimationFrame(drawDependencies);
}
function syncNativeFullscreen() {
  if(nativeFullscreenElement()===document.documentElement){
    nativeFullscreenOwned=chartFullscreen;
    if(!chartFullscreen)releaseNativeFullscreen();
    return;
  }
  if(nativeFullscreenOwned){nativeFullscreenOwned=false;resetChartFullscreen();}
}
document.addEventListener('fullscreenchange',syncNativeFullscreen);
document.addEventListener('webkitfullscreenchange',syncNativeFullscreen);
function revealTaskInChart({smooth=false}={}) {
  if(view!=='overview')return;
  const scroller=q('.plan-scroll'),row=[...document.querySelectorAll('.plan-task')].find(el=>el.dataset.task===currentTaskId);
  if(!scroller||!row)return;
  const behavior=smooth&&!matchMedia('(prefers-reduced-motion:reduce)').matches?'smooth':'instant';
  const bar=row.querySelector('.task-bar').getBoundingClientRect();
  // Portrait uses a document list; keep its selection in place behind the detail.
  if(getComputedStyle(scroller).overflowY==='visible'){
    window.scrollTo({top:scrollY+bar.top+bar.height/2-innerHeight/2,behavior:'instant'});
    return;
  }
  let bounds=scroller.getBoundingClientRect();
  if(!chartFullscreen&&(bounds.top>=innerHeight-80||bounds.bottom<=80)){
    window.scrollTo({top:scrollY+bounds.top-16,behavior:'instant'});
    bounds=scroller.getBoundingClientRect();
  }
  const target=row.querySelector('.task-bar').getBoundingClientRect();
  const header=q('.plan-head')?.getBoundingClientRect().height||0;
  const panelRect=panel.getBoundingClientRect();
  const bottom=!panel.hidden&&!panelExpanded&&panelRect.top>bounds.top?Math.min(innerHeight,panelRect.top):innerHeight;
  const top=Math.max(0,bounds.top)+header;
  const visibleBottom=Math.min(bounds.top+scroller.clientHeight,bottom);
  const left=Math.max(0,bounds.left),right=Math.min(innerWidth,bounds.left+scroller.clientWidth);
  const clamp=(value,max)=>Math.max(0,Math.min(max,value));
  scroller.scrollTo({
    left:clamp(scroller.scrollLeft+target.left+target.width/2-(left+right)/2,scroller.scrollWidth-scroller.clientWidth),
    top:clamp(scroller.scrollTop+target.top+target.height/2-(top+visibleBottom)/2,scroller.scrollHeight-scroller.clientHeight),
    behavior,
  });
}
function openTask(id,checkId,{navigate=true,reveal=true}={}) {
  const t=taskById(id); if(!t)return;
  if(navigate&&currentTaskId===id&&currentCheckId===(checkId||null)&&!panel.hidden){
    if(reveal)requestAnimationFrame(()=>revealTaskInChart({smooth:true}));
    return;
  }
  if(navigate)rememberPosition();
  // Motion cues follow direct choices only. Back/Forward restores run twice
  // (popstate and hashchange), so they stay static rather than flicker.
  const shown=panel.hidden?null:currentTaskId, chosen=navigate&&shown!==id, switching=chosen&&Boolean(shown);
  clearPanelGhost();
  if (panel.hidden) previousFocus=document.activeElement;
  currentTaskId=id;currentCheckId=checkId||null;
  const phase=data.phases?.find(p=>p.id===selectedPhase);
  let scopeChanged=false;
  if(view==='overview'&&phase&&!phase.taskIds.includes(id)){
    selectedPhase=data.phases?.find(p=>p.taskIds.includes(id))?.id||'';scopeChanged=true;
  }
  if(view==='overview'&&query&&!taskMatches(t)){query='';q('#search').value='';scopeChanged=true;}
  if(scopeChanged)render();
  q('#detail').innerHTML=detail(t);
  spaceProseArrows(q('#detail'));
  if(switching)settleDetail(q('#detail .detail-body'));
  document.title=`${t.title} — Sumi`;
  const epoch=navigate?++navigationEpoch:navigationEpoch;
  requestAnimationFrame(()=>{
    if(currentTaskId!==id||epoch!==navigationEpoch)return;
    if(reveal)revealTaskInChart({smooth:navigate});
    drawDependencies();
    if(chosen)pulseProgress([...content.querySelectorAll('[data-progress-task]')].find(el=>el.dataset.task===id));
  });
  for(const row of document.querySelectorAll('.task-row,.plan-task'))row.classList.toggle('selected',row.dataset.task===id);
  for(const segment of content.querySelectorAll('[data-progress-task]')){
    if(segment.dataset.task===id)segment.setAttribute('aria-current','true');else segment.removeAttribute('aria-current');
  }
  if(panel.hidden) { panel.hidden=false; document.body.classList.add('has-detail'); }
  panel.scrollTop=0;
  applyPanelMode();
  q('#detail-title').focus({preventScroll:true});
  if(navigate)writeNavigation();
  if(checkId&&reveal) requestAnimationFrame(()=>{if(currentTaskId===id)document.getElementById(`check-${checkId}`)?.scrollIntoView({block:'start',behavior:'instant'});});
}
function closeTask(navigate=true) {
  if(navigate)rememberPosition();
  const originTask=previousFocus?.dataset.task,originCheck=previousFocus?.dataset.check;
  retirePanel(panel);
  currentTaskId=null;currentCheckId=null;hoveredTaskId=null;panel.hidden=true;panelExpanded=false;
  document.body.classList.remove('has-detail','detail-expanded');document.body.style.overflow=chartFullscreen?'hidden':'';q('main').inert=false;
  render();if(navigate)writeNavigation();
  const restored=[...content.querySelectorAll('[data-task]')].find(el=>el.dataset.task===originTask&&(!originCheck||el.dataset.check===originCheck));
  if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});else if(restored)restored.focus({preventScroll:true});else q(`[data-view="${view}"]`)?.focus({preventScroll:true});
}
function renderSearchResults() {
  const list=q('#search-results');if(!list)return;
  const top=list.scrollTop, focusedTask=document.activeElement?.dataset.searchTask;
  if(!data){list.innerHTML='<p class="search-empty">進捗データを読み込めていません。接続が戻ると、そのまま探せます。</p>';return;}
  const phaseOf=t=>data.phases?.find(p=>p.taskIds.includes(t.id));
  const item=t=>{
    const[state,label]=taskStatus(t),phase=phaseOf(t);
    return `<button class="search-result" data-search-task="${esc(t.id)}"><span class="search-result-title">${esc(t.title)}</span><span class="search-result-meta">${phase?`<span>${esc(phase.title)}</span><span class="meta-sep">·</span>`:''}<i class="status-swatch ${state}"></i><span>${esc(label)}</span></span></button>`;
  };
  const text=searchText.trim().toLocaleLowerCase();
  if(!text){
    const phased=new Set((data.phases||[]).flatMap(p=>p.taskIds));
    const groups=(data.phases||[]).map(p=>({title:p.title,tasks:p.taskIds.map(taskById).filter(Boolean)}));
    const rest=data.tasks.filter(t=>!phased.has(t.id));
    if(rest.length)groups.push({title:'そのほか',tasks:rest});
    list.innerHTML=groups.filter(g=>g.tasks.length).map(g=>`<section class="search-group"><h3 class="search-group-title">${esc(g.title)}<span>${g.tasks.length} 件</span></h3>${g.tasks.map(item).join('')}</section>`).join('')||'<p class="search-empty">表示できるタスクがありません。</p>';
  }else{
    const matches=data.tasks.filter(t=>taskMatches(t,text));
    list.innerHTML=matches.length?`<section class="search-group"><h3 class="search-group-title">該当するタスク<span>${matches.length} 件</span></h3>${matches.map(item).join('')}</section>`:`<p class="search-empty">「${esc(searchText.trim())}」に該当するタスクはありません。</p>`;
  }
  if(focusedTask)[...list.querySelectorAll('[data-search-task]')].find(el=>el.dataset.searchTask===focusedTask)?.focus({preventScroll:true});
  spaceProseArrows(list);
  list.scrollTop=top;
}
function focusAfterSearch() {
  let target=searchReturnFocus?.isConnected?searchReturnFocus:q('[data-action="search-open"]');
  // A hidden or inert return target means the detail panel owns focus now.
  if(target&&(target.closest('[inert]')||!target.getClientRects().length))target=q('#detail-title');
  target?.focus({preventScroll:true});
}
function openSearch(navigate=true) {
  if(searchOpen||!mobileSearch.matches)return;
  searchOpen=true;searchReturnFocus=document.activeElement;
  for(const el of [q('.skip-link'),q('main'),panel,q('#toast')])if(el)el.inert=true;
  document.body.classList.add('search-open');
  applyPanelMode();
  q('#search-overlay').hidden=false;
  const field=q('#search-field');field.value=searchText;renderSearchResults();
  field.focus({preventScroll:true});
  try{field.setSelectionRange(field.value.length,field.value.length);}catch{/* Non-text input types reject selection. */}
  if(navigate){rememberPosition();const before=history.state?.sumiBoard?.key;writeNavigation();searchEntryKey=history.state?.sumiBoard?.key===before?null:navigationKey;}
}
function closeSearch(restoreFocus=true) {
  if(!searchOpen)return;
  searchOpen=false;searchEntryKey=null;searchText='';
  q('#search-overlay').hidden=true;
  for(const el of [q('.skip-link'),panel,q('#toast')])if(el)el.inert=false;
  document.body.classList.remove('search-open');
  applyPanelMode();
  if(restoreFocus)focusAfterSearch();
}
function requestCloseSearch() {
  if(!searchOpen)return;
  // The entry pushed on open is removed by going back, so a closed search
  // never lingers as a phantom history step. Entries from a shared or
  // reloaded URL have no pushed entry; close in place instead.
  if(searchEntryKey&&history.state?.sumiBoard?.key===searchEntryKey){history.back();return;}
  closeSearch();writeNavigation('replace');
}
function chooseSearchResult(id) {
  const t=taskById(id);if(!t)return;
  closeSearch(false);searchReturnFocus=null;
  if(view!=='overview'){view='overview';render();}
  openTask(id,null,{navigate:true,reveal:true});
}
function expandPanel() {
  rememberPosition();
  panelExpanded=!panelExpanded;document.body.classList.toggle('detail-expanded',panelExpanded);q('main').inert=panelExpanded;
  applyPanelMode();
  const button=q('[data-action="expand-panel"]');if(button){button.innerHTML=icon(panelExpanded?'shrink':'expand');button.setAttribute('aria-label',panelExpanded?'一覧と並べて表示':'詳細を大きく表示');}
  writeNavigation('replace');
}
function switchView(next) {
  if(view===next)return;
  rememberPosition();view=next;query='';q('#search').value='';
  if(!panel.hidden)closeTask(false);
  if(chartFullscreen&&view!=='overview'){resetChartFullscreen();releaseNativeFullscreen();}
  render();writeNavigation();
}
function saveObservation(t,c,patch) {
  const k=key(t,c), previous=observations[k];
  observations[k]={...previous,...patch,at:new Date().toISOString()};
  try { localStorage.setItem(storageKey,JSON.stringify(observations)); return true; }
  catch {if(previous)observations[k]=previous;else delete observations[k];toast('ブラウザに保存できませんでした。保存領域の設定を確認してください。');return false;}
}
function refreshTest(t,c) {
  const old=document.getElementById(`check-${c.id}`);
  const textarea=old?.querySelector('textarea'), hadFocus=document.activeElement===textarea;
  const selection=hadFocus?[textarea.selectionStart,textarea.selectionEnd]:null;
  if(old)old.outerHTML=testBlock(t,c);
  if(selection){const next=document.getElementById(`note-${c.id}`);next.focus({preventScroll:true});next.setSelectionRange(...selection);}
  updateHeader();
}
async function fetchData(manual=false) {
  if(loading)return;loading=true;
  try {
    const response=await fetch('./board.json',{cache:'force-cache'});
    if(!response.ok)throw Error('Data unavailable');
    const next=await response.json();
    if(next.version!==1 || !Array.isArray(next.tasks) || !next.tasks.every(t=>typeof t.id==='string'&&typeof t.title==='string'))throw Error('Invalid data');
    const firstLoad=!data;
    data={...next,demoArchive:true};liveSnapshot=true;
    if(firstLoad)restoreNavigation();else render();
    q('#fetch-notice').hidden=true;
  } catch {
    liveSnapshot=false;if(data)render();
    q('#fetch-notice').hidden=false;q('#fetch-notice').textContent='保存されたデモのデータを読み込めませんでした。';
    if(!data){content.innerHTML=empty('デモの記録を読み込めませんでした。');}
  } finally {loading=false;if(searchOpen)renderSearchResults();}
}
document.addEventListener('click',async (event)=>{
  const el=event.target.closest('button');if(!el)return;
  if(el.dataset.view)switchView(el.dataset.view);
  if(el.dataset.switch)switchView(el.dataset.switch);
  if(el.dataset.filter){rememberPosition();checkFilter=el.dataset.filter;render();writeNavigation();}
  if(el.dataset.task)openTask(el.dataset.task,el.dataset.check);
  if(el.dataset.action==='search-open')openSearch();
  if(el.dataset.action==='close-search')requestCloseSearch();
  if(el.dataset.searchTask)chooseSearchResult(el.dataset.searchTask);
  if(el.dataset.action==='runs'){const list=q('#task-runs');list.hidden=!list.hidden;el.setAttribute('aria-expanded',String(!list.hidden));}
  if(el.dataset.action==='connection'){const info=q('#connection-info');info.hidden=!info.hidden;el.setAttribute('aria-expanded',String(!info.hidden));}
  if(el.dataset.action==='fullscreen-chart')await toggleChartFullscreen();
  if(el.dataset.action==='close-dialog')closeTask();
  if(el.dataset.action==='expand-panel')expandPanel();
  if(Object.hasOwn(el.dataset,'phase')){
    const scopeChanged=selectedPhase!==el.dataset.phase;
    rememberPosition();selectedPhase=el.dataset.phase;render();
    if(scopeChanged)revealScope(q('.plan-scroll'));
    const epoch=++navigationEpoch;
    const selected=[...content.querySelectorAll('.plan-task')].some(row=>row.dataset.task===currentTaskId);
    if(!selected&&q('.board-scroll')){q('.board-scroll').scrollTop=0;q('.board-scroll').scrollLeft=0;}
    writeNavigation();
    if(selected)requestAnimationFrame(()=>{if(epoch===navigationEpoch)revealTaskInChart({smooth:true});});
  }
  if(el.dataset.action==='dependencies'){rememberPosition();showDependencies=!showDependencies;render();writeNavigation('replace');}
  if(el.dataset.action==='clear-search'){query='';q('#search').value='';render();writeNavigation('replace');q('#search').focus();}
  if(el.dataset.action==='copy-link'){try{await navigator.clipboard.writeText(location.href);toast('このタスクへのリンクをコピーしました');}catch{toast('アドレスバーの URL から共有できます');}}
  if(el.dataset.action==='export'){
    const records=Object.entries(observations).map(([id,record])=>{const found=checks().find(({t,c})=>key(t,c)===id);return {id,task:found?.t.title,check:found?.c.title,...record};});
    if(!records.length){toast('書き出す個人メモはまだありません');return;}
    const blob=new Blob([JSON.stringify({format:'sumi-development-observations',version:1,exportedAt:new Date().toISOString(),records},null,2)],{type:'application/json'}), objectURL=URL.createObjectURL(blob), a=document.createElement('a');a.href=objectURL;a.download=`sumi-verification-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(objectURL),1000);toast('個人メモを書き出しました');
  }
  const t=taskById(currentTaskId);
  if(el.dataset.result&&t){const c=t.checks?.find(c=>c.id===el.dataset.checkId);if(c&&saveObservation(t,c,{result:el.dataset.result})){refreshTest(t,c);toast('あなたの確認結果を、このブラウザに保存しました');}}
  if(el.dataset.clearCheck&&t){const c=t.checks?.find(c=>c.id===el.dataset.clearCheck);if(c){const k=key(t,c),previous=observations[k];delete observations[k];try{localStorage.setItem(storageKey,JSON.stringify(observations));refreshTest(t,c);toast('個人メモを消しました。開発側の確認記録は引き続き表示されます');}catch{if(previous)observations[k]=previous;toast('保存できませんでした');}}}
});
document.addEventListener('input',event=>{
  if(event.target.id==='search'){query=event.target.value;render();writeNavigation('replace');}
  if(event.target.id==='search-field'){searchText=event.target.value;renderSearchResults();writeNavigation('replace');}
  const id=event.target.dataset.note,t=taskById(currentTaskId),c=t?.checks?.find(c=>c.id===id);
  if(c&&saveObservation(t,c,{note:event.target.value})){const status=event.target.parentElement.querySelector('[data-save-state]');if(status)status.textContent=`個人メモ保存済み · ${time(new Date().toISOString())}`;}
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&searchOpen){event.preventDefault();if(!event.isComposing)requestCloseSearch();return;}if(event.key==='Escape'&&panel.hidden&&chartFullscreen){event.preventDefault();toggleChartFullscreen();return;}if(event.key==='Escape'&&!panel.hidden&&!event.isComposing){if(panelExpanded)expandPanel();else closeTask();return;}if(event.key==='/'&&panel.hidden&&!searchOpen&&!event.isComposing&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){event.preventDefault();if(mobileSearch.matches)openSearch();else q('#search').focus();}});
q('#search-field').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();q('.search-result')?.click();}});
q('#search-overlay').addEventListener('keydown',event=>{
  if(event.key!=='Tab'||!searchOpen)return;
  const targets=[...q('#search-overlay').querySelectorAll('input,button')].filter(el=>!el.disabled&&el.getClientRects().length);
  const first=targets[0],last=targets.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
});
mobileSearch.addEventListener('change',()=>{if(searchOpen&&!mobileSearch.matches){closeSearch(false);writeNavigation('replace');}});
// Back/forward can change only the query string; hashchange alone is insufficient.
window.addEventListener('popstate',restoreNavigation);
window.addEventListener('hashchange',restoreNavigation);
window.addEventListener('storage',event=>{if(event.key===storageKey){try{observations=JSON.parse(event.newValue||'{}');render();}catch{/* Keep current valid personal notes. */}}});
fetchData();

window.addEventListener("resize",()=>{applyPanelMode();requestAnimationFrame(drawDependencies);});

content.addEventListener('pointerover',event=>{if(event.pointerType==='touch')return;const row=event.target.closest('.plan-task');const next=row?.dataset.task||null;if(next!==hoveredTaskId){hoveredTaskId=next;requestAnimationFrame(drawDependencies);}});
content.addEventListener('pointerleave',()=>{hoveredTaskId=null;requestAnimationFrame(drawDependencies);});

document.fonts?.addEventListener('loadingdone',()=>requestAnimationFrame(drawDependencies));
