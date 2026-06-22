// Exeliq CRM Dashboard v25
// Points 1-8, 10: non-admin fix, role-based views, 3 heatmaps,
// quarterly cards, revenue donut, monthly lost, navigation

(function () {

	function loadChartJS(cb) {
		if (window.Chart) { cb(); return; }
		var s = document.createElement('script');
		s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
		s.onload = cb; s.onerror = cb;
		document.head.appendChild(s);
	}

	function initDashboard(wrapper) {
		// Prevent double initialization
		if (frappe.crm_dashboard) {
			frappe.crm_dashboard.destroy_charts();
		}
		// Remove any previously injected page_form to prevent duplicate filters
		var old_pf = document.getElementById('crm-page-form');
		if (old_pf) old_pf.parentElement.removeChild(old_pf);

		var page = frappe.ui.make_app_page({
			parent: wrapper, title: 'CRM Pipeline Dashboard', single_column: true
		});
		frappe.crm_dashboard = new CRMDashboard(page);
	}

	function registerPage() {
		if (!frappe || !frappe.pages) { setTimeout(registerPage, 100); return; }
		if (!frappe.pages['crm-dashboard']) frappe.pages['crm-dashboard'] = {};

		// Frappe v15 passes the PAGE OBJECT (not DOM wrapper) to on_page_load
		frappe.pages['crm-dashboard'].on_page_load = function (wrapper) {
			loadChartJS(function () { initDashboard(wrapper); });
		};

		// Race condition fix:
		// app_include_js loads AFTER Frappe router already rendered crm-dashboard.
		// on_page_load was undefined then so nothing happened.
		// We detect this and force initialization.
		// Strategy: try immediately, then retry at 300ms, 700ms, 1500ms.
		function _try_init() {
			if (frappe.crm_dashboard) return; // already initialized

			// Check route — use both router and URL as fallback
			var cur = frappe.router && frappe.router.current_route;
			var on_crm = (cur && cur.length > 0 && cur[0] === 'crm-dashboard') ||
			             window.location.href.indexOf('/crm-dashboard') !== -1;
			if (!on_crm) return;

			// Find or create a container
			var existing = document.querySelector('[data-page-route="crm-dashboard"]')
			            || document.getElementById('page-crm-dashboard');

			if (existing) {
				loadChartJS(function () { initDashboard(existing); });
				return;
			}

			// No container — create one and attach to body
			var container = document.createElement('div');
			container.className = 'page-container';
			container.setAttribute('data-page-route', 'crm-dashboard');
			container.style.cssText = 'position:fixed;top:56px;left:0;right:0;bottom:0;' +
				'background:var(--bg-color,#fff);overflow-y:auto;z-index:10;padding-bottom:20px';
			document.body.appendChild(container);
			loadChartJS(function () { initDashboard(container); });
		}

		// Retry at 0, 300, 700, 1500ms — covers all load timing scenarios
		_try_init();
		setTimeout(_try_init, 300);
		setTimeout(_try_init, 700);
		setTimeout(_try_init, 1500);
	}

	// ── Helpers ───────────────────────────────────────────────────────

	function fmt(v) {
		v = parseFloat(v) || 0;
		if (v >= 10000000) return '₹' + (v/10000000).toFixed(1) + ' Cr';
		if (v >= 100000)   return '₹' + (v/100000).toFixed(1) + 'L';
		if (v >= 1000)     return '₹' + (v/1000).toFixed(1) + 'K';
		return v > 0 ? '₹' + Math.round(v) : '₹0';
	}

	function user_label(u) {
		if (!u) return '-';
		var p = u.indexOf('@') !== -1 ? u.split('@')[0] : u;
		return p.replace(/[._]/g, ' ').replace(/\b\w/g, function(c){return c.toUpperCase();});
	}

	function hm_color(t) {
		return 'rgb('+Math.round(225+t*(8-225))+','+Math.round(245+t*(110-245))+','+Math.round(238+t*(72-238))+')';
	}

	var C = {
		blue:'#3B82F6', green:'#10B981', purple:'#8B5CF6', orange:'#F97316',
		red:'#EF4444', teal:'#14B8A6', indigo:'#6366F1', pink:'#EC4899',
		yellow:'#F59E0B', cyan:'#06B6D4'
	};
	var PALETTE = [C.indigo,C.green,C.yellow,C.red,C.blue,
	               C.purple,C.pink,C.teal,C.orange,C.cyan,
	               '#84CC16','#A855F7','#D946EF','#0EA5E9','#22C55E'];

	var WON_STAGE  = 'Closed Won';
	var LOST_STAGE = 'Closed Lost';

	// ── CRMDashboard ──────────────────────────────────────────────────

	function CRMDashboard(page) {
		this.page          = page;
		this.is_mgr        = frappe.user.has_role('Sales Manager') || frappe.user.has_role('System Manager');
		this.me            = frappe.session.user;
		this.metric        = 'count';
		this.lead_metric   = 'count';
		this.charts        = {};
		this.loading       = false;
		this.pending_reload = false;
		this.initializing  = true;
		this._updating_sp  = false;

		// Data
		this.opps                  = [];
		this.leads                 = [];
		this.stages                = [];
		this.lead_statuses         = [];
		this.stage_color_map       = {};
		this.salespersons          = [];
		this.kpis                  = {};
		this.funnel                = [];
		this.territory_stats       = [];
		this.salesperson_stats     = [];
		this.monthly_trends        = [];
		this.source_stats          = [];
		this.fiscal_years          = {};
		this.quarterly_revenue     = [];
		this.lead_heatmap          = [];
		this.monthly_stage_heatmap = {};
		this.revenue_contribution  = [];

		this._terr_selection = null;
		this._src_selection  = null;
		this._mshm_user      = null; // manager user filter for monthly stage heatmap


		this.setup_content();
		this.setup_filters();
		this.mount_filters();
		this.initializing = false;
		this.load_data();
	}

	// ── CSS ───────────────────────────────────────────────────────────

	var CSS = `
<style>
.crm-dash{padding:8px 4px 24px}
.crm-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:14px}
.crm-metric{background:var(--fg-color);border:1px solid var(--border-color);border-radius:10px;padding:16px 18px;position:relative;overflow:hidden}
.crm-metric::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--ma,#6366F1)}
.crm-metric-label{font-size:10px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.crm-metric-val{font-size:24px;font-weight:700;color:var(--text-color);line-height:1.1}
.crm-metric-sub{font-size:11px;color:var(--text-muted);margin-top:5px}
.crm-metric-val.green{color:#10B981}.crm-metric-val.red{color:#EF4444}
/* Quarterly cards */
.crm-quarterly{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
@media(max-width:700px){.crm-quarterly{grid-template-columns:repeat(2,1fr)}}
.crm-q-card{background:var(--fg-color);border:1px solid var(--border-color);border-radius:10px;padding:14px 16px;position:relative;overflow:hidden}
.crm-q-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--qa,#6366F1)}
.crm-q-card.current-quarter{border-color:#6366F1;box-shadow:0 0 0 1px #6366F1}
.crm-q-label{font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
.crm-q-val{font-size:20px;font-weight:700;color:#10B981}
.crm-q-sub{font-size:11px;color:var(--text-muted);margin-top:4px}
/* Cards */
.crm-card{background:var(--fg-color);border:1px solid var(--border-color);border-radius:10px;padding:18px;margin-bottom:18px}
.crm-section-title{font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:14px}
.crm-two-col{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px}
@media(max-width:800px){.crm-two-col{grid-template-columns:1fr}}
/* Pipeline */
.crm-pipeline{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px}
.crm-pipeline::-webkit-scrollbar{height:4px}
.crm-pipeline::-webkit-scrollbar-thumb{background:#6366F1;border-radius:2px}
.crm-stage{flex:0 0 auto;min-width:150px;border:1px solid var(--border-color);border-radius:10px;padding:18px 20px;border-top:4px solid #888;transition:box-shadow .2s}
.crm-stage:hover{box-shadow:0 4px 12px rgba(0,0,0,.08)}
.crm-stage-name{font-size:11px;color:var(--text-muted);margin-bottom:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.crm-stage-count{font-size:36px;font-weight:800;color:var(--text-color);line-height:1}
.crm-stage-val{font-size:13px;color:var(--text-muted);margin-top:6px;font-weight:500}
/* Chart filters */
.crm-chart-filter{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.crm-chart-filter label{font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;white-space:nowrap}
.crm-multiselect-wrap{position:relative;flex:1;min-width:180px}
.crm-multiselect-btn{width:100%;padding:5px 10px;font-size:12px;border:1px solid var(--border-color);border-radius:6px;background:var(--fg-color);color:var(--text-color);cursor:pointer;text-align:left;display:flex;justify-content:space-between;align-items:center}
.crm-multiselect-dropdown{display:none;position:absolute;top:100%;left:0;right:0;background:var(--fg-color);border:1px solid var(--border-color);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:1000;max-height:260px;overflow:hidden;margin-top:3px}
.crm-multiselect-dropdown.open{display:flex;flex-direction:column}
.crm-ms-search{padding:8px;border-bottom:1px solid var(--border-color)}
.crm-ms-search input{width:100%;padding:5px 8px;font-size:12px;border:1px solid var(--border-color);border-radius:4px;background:var(--fg-color);color:var(--text-color);outline:none}
.crm-ms-list{overflow-y:auto;max-height:180px}
.crm-ms-item{display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;font-size:12px}
.crm-ms-item:hover{background:rgba(99,102,241,.06)}
.crm-ms-item input[type=checkbox]{margin:0;cursor:pointer;accent-color:#6366F1}
.crm-ms-footer{padding:6px 10px;border-top:1px solid var(--border-color);display:flex;gap:6px}
.crm-ms-footer button{font-size:11px;padding:3px 10px;border-radius:4px;border:1px solid var(--border-color);cursor:pointer;background:var(--fg-color)}
.crm-ms-footer button.primary{background:#6366F1;color:#fff;border-color:#6366F1}
/* Heatmaps */
.crm-hm-wrap{overflow-x:auto}
.crm-hm-table{width:100%;border-collapse:separate;border-spacing:3px;min-width:600px;font-size:11px}
.crm-hm-table th{color:var(--text-muted);padding:4px 6px;text-align:center;font-weight:500;white-space:nowrap}
.crm-hm-table th.row-h{text-align:left;min-width:120px;font-size:12px;font-weight:600}
.crm-hm-cell{border-radius:5px;padding:7px 3px;text-align:center}
.crm-hm-cell .cv{font-size:12px;font-weight:700}
.crm-hm-cell .cs{font-size:9px;margin-top:1px;opacity:.85}
.crm-hm-total{font-size:12px;font-weight:700;padding:4px 8px;text-align:center;color:var(--text-muted)}
.crm-hm-total span{font-size:10px;font-weight:400}
.crm-hm-footer{color:var(--text-muted)!important;font-weight:400!important;font-size:11px!important;padding:3px 6px!important}
.crm-toggle-row{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.crm-toggle{font-size:12px;padding:5px 14px;border-radius:6px;border:1px solid var(--border-color);background:var(--fg-color);color:var(--text-muted);cursor:pointer;font-weight:500}
.crm-toggle.active{background:#EEF2FF;color:#6366F1;border-color:#6366F1}
.crm-legend{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;color:var(--text-muted)}
.crm-legend-strip{display:flex;height:8px;width:120px;border-radius:4px;overflow:hidden}
/* Salesperson */
.crm-sp-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border-color)}
.crm-sp-row:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}
.crm-sp-info{display:flex;align-items:center;gap:10px}
.crm-avatar{width:36px;height:36px;border-radius:50%;background:#EEF2FF;color:#6366F1;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
.crm-progress{height:4px;background:var(--border-color);border-radius:2px;margin-top:6px}
.crm-progress-fill{height:100%;border-radius:2px;transition:width .4s}
.crm-empty{text-align:center;padding:36px;color:var(--text-muted);font-size:13px}
.crm-mgr-only{/* shown only to managers */}
</style>`;

	// ── HTML skeleton ─────────────────────────────────────────────────

	CRMDashboard.prototype.setup_content = function () {
		var self = this;
		var mgr  = this.is_mgr;

		var manager_heatmaps = `
  <!-- Opp Heatmap: users vs stages (managers only) -->
  \${mgr ? \`
  <div class="crm-card crm-mgr-only">
    <div class="crm-section-title">Opportunity heatmap — users vs stages</div>
    <div class="crm-toggle-row">
      <button class="crm-toggle active" id="hm-count">Deal count</button>
      <button class="crm-toggle" id="hm-value">Deal value (₹)</button>
      <button class="crm-toggle" id="hm-both">Both</button>
    </div>
    <div class="crm-hm-wrap"><div id="crm-opp-heatmap"></div></div>
    <div class="crm-legend"><span>Low</span><div class="crm-legend-strip" id="crm-opp-hm-legend"></div><span>High</span></div>
  </div>
  <!-- Lead Heatmap: users vs lead status (managers only) -->
  <div class="crm-card crm-mgr-only">
    <div class="crm-section-title">Lead heatmap — users vs lead status</div>
    <div class="crm-hm-wrap"><div id="crm-lead-heatmap"></div></div>
    <div class="crm-legend"><span>Low</span><div class="crm-legend-strip" id="crm-lead-hm-legend"></div><span>High</span></div>
  </div>\` : ''}
  <!-- Monthly Stage Heatmap: months vs stages (ALL users, managers get user selector) -->
  <div class="crm-card">
    <div class="crm-section-title">Pipeline — months vs stages</div>
    <div class="crm-toggle-row">
      <button class="crm-toggle active" id="mshm-count">Deal count</button>
      <button class="crm-toggle" id="mshm-value">Deal value (₹)</button>
      \${mgr ? \`<div style="margin-left:auto;display:flex;align-items:center;gap:6px">
        <label style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase">User</label>
        <select id="mshm-user-sel" style="font-size:12px;padding:4px 8px;border:1px solid var(--border-color);border-radius:5px;background:var(--fg-color);color:var(--text-color)">
          <option value="">All</option>
        </select>
      </div>\` : ''}
    </div>
    <div class="crm-hm-wrap"><div id="crm-monthly-stage-heatmap"></div></div>
    <div class="crm-legend"><span>Low</span><div class="crm-legend-strip" id="crm-mshm-legend"></div><span>High</span></div>
  </div>`;

		var quarterly_cards = ''; // rendered inline below

		var revenue_donut = mgr ? `
    <div class="crm-card crm-mgr-only">
      <div class="crm-section-title">Revenue contribution by salesperson</div>
      <div style="position:relative;height:240px"><canvas id="crm-revenue-donut"></canvas></div>
    </div>` : '';

		this.page.main.html(CSS + `
<div class="crm-dash">
  <!-- Metric cards -->
  <div id="crm-metrics" class="crm-metrics">
    <div class="crm-metric"><div class="crm-metric-label">Loading…</div></div>
  </div>

  <!-- Quarterly Revenue — all users (Sales User sees own data only) -->
  <div class="crm-card">
    <div class="crm-section-title">Quarterly revenue — current fiscal year</div>
    <div id="crm-quarterly" class="crm-quarterly"></div>
  </div>

  <!-- Pipeline by stage -->
  <div class="crm-card">
    <div class="crm-section-title">Pipeline by stage</div>
    <div id="crm-pipeline" class="crm-pipeline"></div>
  </div>

  <!-- Monthly trends -->
  <div class="crm-two-col">
    <div class="crm-card">
      <div class="crm-section-title">Monthly opportunities &amp; leads created</div>
      <div style="position:relative;height:220px"><canvas id="crm-monthly-chart"></canvas></div>
    </div>
    <div class="crm-card">
      <div class="crm-section-title">Monthly won &amp; lost — deals &amp; revenue</div>
      <div style="position:relative;height:220px"><canvas id="crm-revenue-chart"></canvas></div>
    </div>
  </div>

  <!-- Lead status + Revenue donut / Source -->
  <div class="crm-two-col">
    <div class="crm-card">
      <div class="crm-section-title">Lead status distribution</div>
      <div style="position:relative;height:240px"><canvas id="crm-lead-chart"></canvas></div>
    </div>
    ${revenue_donut || `
    <div class="crm-card">
      <div class="crm-section-title">Source distribution</div>
      <div class="crm-chart-filter">
        <label>Filter</label>
        <div class="crm-multiselect-wrap" id="src-ms-wrap">
          <button class="crm-multiselect-btn" id="src-ms-btn"><span id="src-ms-label">All sources</span><span>▾</span></button>
          <div class="crm-multiselect-dropdown" id="src-ms-dropdown">
            <div class="crm-ms-search"><input type="text" id="src-ms-search" placeholder="Search…"></div>
            <div class="crm-ms-list" id="src-ms-list"></div>
            <div class="crm-ms-footer">
              <button onclick="frappe.crm_dashboard._ms_select_all('src')">All</button>
              <button onclick="frappe.crm_dashboard._ms_clear_all('src')">None</button>
              <button class="primary" onclick="frappe.crm_dashboard._ms_apply('src')">Apply</button>
            </div>
          </div>
        </div>
      </div>
      <div style="position:relative;height:190px"><canvas id="crm-source-chart"></canvas></div>
    </div>`}
  </div>

  <!-- Source (mgr) + Territory -->
  ${mgr ? `
  <div class="crm-two-col">
    <div class="crm-card crm-mgr-only">
      <div class="crm-section-title">Source distribution</div>
      <div class="crm-chart-filter">
        <label>Filter</label>
        <div class="crm-multiselect-wrap" id="src-ms-wrap">
          <button class="crm-multiselect-btn" id="src-ms-btn"><span id="src-ms-label">All sources</span><span>▾</span></button>
          <div class="crm-multiselect-dropdown" id="src-ms-dropdown">
            <div class="crm-ms-search"><input type="text" id="src-ms-search" placeholder="Search…"></div>
            <div class="crm-ms-list" id="src-ms-list"></div>
            <div class="crm-ms-footer">
              <button onclick="frappe.crm_dashboard._ms_select_all('src')">All</button>
              <button onclick="frappe.crm_dashboard._ms_clear_all('src')">None</button>
              <button class="primary" onclick="frappe.crm_dashboard._ms_apply('src')">Apply</button>
            </div>
          </div>
        </div>
      </div>
      <div style="position:relative;height:190px"><canvas id="crm-source-chart"></canvas></div>
    </div>
    <div class="crm-card crm-mgr-only">
      <div class="crm-section-title">Territory distribution</div>
      <div class="crm-chart-filter">
        <label>Filter</label>
        <div class="crm-multiselect-wrap" id="terr-ms-wrap">
          <button class="crm-multiselect-btn" id="terr-ms-btn"><span id="terr-ms-label">All territories</span><span>▾</span></button>
          <div class="crm-multiselect-dropdown" id="terr-ms-dropdown">
            <div class="crm-ms-search"><input type="text" id="terr-ms-search" placeholder="Search…"></div>
            <div class="crm-ms-list" id="terr-ms-list"></div>
            <div class="crm-ms-footer">
              <button onclick="frappe.crm_dashboard._ms_select_all('terr')">All</button>
              <button onclick="frappe.crm_dashboard._ms_clear_all('terr')">None</button>
              <button class="primary" onclick="frappe.crm_dashboard._ms_apply('terr')">Apply</button>
            </div>
          </div>
        </div>
      </div>
      <div style="position:relative;height:190px"><canvas id="crm-territory-chart"></canvas></div>
    </div>
  </div>` : ''}

  <!-- Heatmaps -->
  ${manager_heatmaps}

  <!-- Salesperson performance -->
  <div class="crm-card">
    <div class="crm-section-title">Salesperson performance</div>
    <div id="crm-sp-perf" style="overflow-y:auto;max-height:320px"></div>
  </div>
</div>`);

		// Wire heatmap toggles
		var self2 = self;
		if (mgr) {
			document.getElementById('hm-count').onclick = function(){self2.set_metric('count',this,'opp');};
			document.getElementById('hm-value').onclick = function(){self2.set_metric('value',this,'opp');};
			document.getElementById('hm-both').onclick  = function(){self2.set_metric('both', this,'opp');};
		}
		// Monthly stage heatmap toggles — all users
		document.getElementById('mshm-count').onclick = function(){self2.set_metric('count',this,'ms');};
		document.getElementById('mshm-value').onclick = function(){self2.set_metric('value',this,'ms');};

		// Close dropdowns on outside click
		document.addEventListener('click', function(e){
			['src','terr'].forEach(function(k){
				var w=document.getElementById(k+'-ms-wrap');
				var d=document.getElementById(k+'-ms-dropdown');
				if(w&&d&&!w.contains(e.target)) d.classList.remove('open');
			});
		});
	};

	// ── Filters ───────────────────────────────────────────────────────

	CRMDashboard.prototype.setup_filters = function () {
		var self = this;

		this.f_period = this.page.add_field({
			fieldtype:'Select', fieldname:'period', label:'Range',
			options:['Today','This Week','This Month','Last Month',
			         'This Quarter','Last Quarter','This FY','Last FY',
			         'This Year','Custom'].join('\n'),
			default:'This Month',
			change:function(){
				if(self.initializing||self._updating_sp) return;
				var p=self.f_period.get_value();
				if(p==='Custom') return;
				var d=self.period_dates(p);
				if(d){self.f_from.set_value(d[0]);self.f_to.set_value(d[1]);}
				self.load_data();
			}
		});

		var def = this.period_dates('This Month');
		this.f_from = this.page.add_field({
			fieldtype:'Date', fieldname:'from_date', label:'From', default:def[0],
			change:function(){
				if(self.initializing||self._updating_sp) return;
				self.f_period.set_value('Custom'); self.load_data();
			}
		});
		this.f_to = this.page.add_field({
			fieldtype:'Date', fieldname:'to_date', label:'To', default:def[1],
			change:function(){
				if(self.initializing||self._updating_sp) return;
				self.f_period.set_value('Custom'); self.load_data();
			}
		});

		if (this.is_mgr) {
			this.f_sp = this.page.add_field({
				fieldtype:'Select', fieldname:'salesperson', label:'Salesperson',
				options:'All', default:'All',
				change:function(){
					if(self.initializing||self._updating_sp) return;
					self.load_data();
				}
			});
		}

		this.page.add_inner_button('Refresh', function(){self.load_data();});
	};

	CRMDashboard.prototype.mount_filters = function () {
		var pf = this.page.page_form;
		if (!pf||!pf.length) return;
		var hc = document.querySelector('.page-head .container');
		if (!hc) return;

		// Remove any stale page-form from previous init
		var stale = hc.querySelector('.page-form.row');
		if (stale && stale !== pf[0]) stale.parentElement.removeChild(stale);

		// Tag it so we can find it on re-init
		pf[0].id = 'crm-page-form';
		hc.appendChild(pf[0]);

		var st = document.getElementById('crm-pf-style') || document.createElement('style');
		st.id = 'crm-pf-style';
		st.textContent = '.page-form.row{display:flex!important;flex-wrap:wrap!important;gap:8px!important;padding:6px 0 8px 0!important;align-items:flex-end!important;width:100%!important;border-top:1px solid var(--border-color)!important;margin-top:4px!important}';
		document.head.appendChild(st);
	};

	CRMDashboard.prototype.period_dates = function (p) {
		var now = frappe.datetime.now_date();
		if (p==='Today')        return [now,now];
		if (p==='This Week')    return [frappe.datetime.week_start(),now];
		if (p==='This Month')   return [frappe.datetime.month_start(),now];
		if (p==='This Quarter') return [frappe.datetime.quarter_start(),now];
		if (p==='This Year')    return [frappe.datetime.year_start(),now];
		if (p==='This FY'){var fy=this.fiscal_years&&this.fiscal_years.current; return fy?[fy.from,fy.to]:[frappe.datetime.year_start(),now];}
		if (p==='Last FY'){var lfy=this.fiscal_years&&this.fiscal_years.last; return lfy?[lfy.from,lfy.to]:null;}
		if (p==='Last Month'){
			var d=frappe.datetime.str_to_obj(frappe.datetime.month_start());
			d.setDate(d.getDate()-1);var end=frappe.datetime.obj_to_str(d);d.setDate(1);
			return [frappe.datetime.obj_to_str(d),end];
		}
		if (p==='Last Quarter'){
			var qs=frappe.datetime.str_to_obj(frappe.datetime.quarter_start());
			qs.setDate(qs.getDate()-1);var qe=frappe.datetime.obj_to_str(qs);
			var qsm=new Date(qs);qsm.setMonth(qsm.getMonth()-2);qsm.setDate(1);
			return [frappe.datetime.obj_to_str(qsm),qe];
		}
		return [frappe.datetime.month_start(),now];
	};

	CRMDashboard.prototype.get_f = function () {
		return {
			from: (this.f_from&&this.f_from.get_value())||frappe.datetime.month_start(),
			to:   (this.f_to&&this.f_to.get_value())||frappe.datetime.now_date(),
			sp:   (this.is_mgr&&this.f_sp&&this.f_sp.get_value()!=='All')?this.f_sp.get_value():null
		};
	};

	// ── Data ─────────────────────────────────────────────────────────

	CRMDashboard.prototype.destroy_charts = function () {
		var self=this;
		Object.keys(self.charts).forEach(function(k){
			try{if(self.charts[k])self.charts[k].destroy();}catch(e){}
			delete self.charts[k];
		});
		self.charts={};
	};

	CRMDashboard.prototype.load_data = function () {
		var self=this;
		if(this.loading){this.pending_reload=true;return;}
		this.loading=true;
		var f=this.get_f();
		this.destroy_charts();
		document.getElementById('crm-metrics').innerHTML=
			'<div class="crm-metric"><div class="crm-metric-label">Loading…</div></div>';

		frappe.call({
			method:'exeliq_crm.exeliq_crm.api.dashboard.get_dashboard_data',
			args:{from_date:f.from, to_date:f.to, salesperson:f.sp||null},
			callback:function(r){
				self.loading=false;
				if(!r.message||r.message.error){
					document.getElementById('crm-metrics').innerHTML=
						'<div style="color:#EF4444;padding:10px">Error: '+(r.message&&r.message.error||'No data')+'</div>';
					return;
				}
				var d=r.message;
				self.opps                  = d.opportunities||[];
				self.leads                 = d.leads||[];
				self.kpis                  = d.kpis||{};
				self.territory_stats       = d.territory_stats||[];
				self.salesperson_stats     = d.salesperson_stats||[];
				self.salespersons          = d.salespersons||[];
				self.monthly_trends        = d.monthly_trends||[];
				self.source_stats          = d.source_stats||[];
				self.fiscal_years          = d.fiscal_years||{};
				self.quarterly_revenue     = d.quarterly_revenue||[];
				self.lead_heatmap          = d.lead_heatmap||[];
				self.monthly_stage_heatmap = d.monthly_stage_heatmap||{};
				self.revenue_contribution  = d.revenue_contribution||[];

				self.lead_statuses         = d.lead_statuses||['Lead','Open','Replied','Opportunity',
				                             'Quotation','Lost Quotation','Interested','Converted','Do Not Contact'];

				self.stages=(d.sales_stages||[]).map(function(s){return s.label||s.name;});
				self.stage_color_map={};
				self.stages.forEach(function(s,i){self.stage_color_map[s]=PALETTE[i%PALETTE.length];});

				var fd=d.funnel||{};
				self.funnel=self.stages.map(function(s){
					var row=fd[s]||{count:0,value:0};
					return {stage:s,count:row.count,value:row.value};
				});

				// Update salesperson dropdown
				if(self.f_sp&&self.salespersons.length){
					self._updating_sp=true;
					var cur=self.f_sp.get_value();
					self.f_sp.df.options=['All'].concat(self.salespersons.map(function(sp){return sp.user;})).join('\n');
					self.f_sp.refresh();
					var sel=self.f_sp.$wrapper&&self.f_sp.$wrapper[0]&&self.f_sp.$wrapper[0].querySelector('select');
					if(sel){Array.from(sel.options).forEach(function(opt){
						if(!opt.value||opt.value==='All') return;
						var sp=self.salespersons.filter(function(s){return s.user===opt.value;})[0];
						if(sp&&sp.full_name) opt.text=sp.full_name;
					});}
					if(cur&&cur!=='All') self.f_sp.set_value(cur);
					setTimeout(function(){self._updating_sp=false;},200);
				}

				// Build multiselect data
				self._ms_items_terr=(self.territory_stats||[]).map(function(t){return t.territory;}).filter(Boolean).sort();
				self._ms_items_src =(self.source_stats||[]).map(function(s){return s.source;}).filter(Boolean).sort();
				self._build_multiselect('terr',self._ms_items_terr,self._terr_selection);
				self._build_multiselect('src', self._ms_items_src, self._src_selection);

				self.render_all();

				if(self.pending_reload){self.pending_reload=false;self.load_data();}
			},
			error:function(err){
				self.loading=false;
				document.getElementById('crm-metrics').innerHTML=
					'<div style="color:#EF4444;padding:10px">Error loading data. Check console.</div>';
				console.error('CRM Dashboard:',err);
			}
		});
	};

	// ── Render ────────────────────────────────────────────────────────

	CRMDashboard.prototype.render_all = function () {
		this.render_metrics();
		this.render_quarterly(); // all users see quarterly (API filters by role)
		this.render_pipeline();
		this.render_monthly_chart();
		this.render_revenue_chart();
		this.render_lead_chart();
		if(this.is_mgr){
			this.render_revenue_donut();
			this.render_source_chart();
			this.render_territory();
			this.render_opp_heatmap();
			this.render_lead_heatmap();
		} else {
			this.render_source_chart();
		}
		this.render_monthly_stage_heatmap(); // all users
		this.render_sp_perf();
	};

	CRMDashboard.prototype.stage_color=function(s){return this.stage_color_map[s]||'#6366F1';};

	// ── Metrics ───────────────────────────────────────────────────────

	CRMDashboard.prototype.render_metrics = function () {
		var k=this.kpis, conv=parseFloat(k.conversion)||0;
		var accents=[C.indigo,C.blue,C.purple,C.green,C.red,C.yellow,C.teal];
		var cards=[
			['Total Leads',    k.total_leads||0,           'In selected period',                ''],
			['Opportunities',  k.total_opportunities||0,   (k.pipeline_count||0)+' pipeline',   ''],
			['Pipeline Value', fmt(k.pipeline_value||0),   'Excl. Won & Lost',                  ''],
			['Closed Won',     fmt(k.won_value||0),        (k.won_count||0)+' deals',           'green'],
			['Closed Lost',    k.lost_count||0,            fmt(k.lost_value||0),                'red'],
			['Conv. Rate',     conv+'%',                   'Won / (Won+Lost)',                  conv>=30?'green':'red'],
			['Avg Deal Size',  fmt(k.average_deal_size||0),'Per won deal',                      '']
		];
		document.getElementById('crm-metrics').innerHTML=cards.map(function(c,i){
			return '<div class="crm-metric" style="--ma:'+accents[i]+'">' +
				'<div class="crm-metric-label">'+c[0]+'</div>' +
				'<div class="crm-metric-val '+c[3]+'">'+c[1]+'</div>' +
				'<div class="crm-metric-sub">'+c[2]+'</div></div>';
		}).join('');
	};

	// ── Quarterly Revenue ─────────────────────────────────────────────

	CRMDashboard.prototype.render_quarterly = function () {
		var el=document.getElementById('crm-quarterly');
		if(!el) return;
		var qcolors=[C.indigo,C.green,C.orange,C.purple];
		el.innerHTML=this.quarterly_revenue.map(function(q,i){
			return '<div class="crm-q-card'+(q.is_current?' current-quarter':'')+'" style="--qa:'+qcolors[i%4]+'">' +
				'<div class="crm-q-label">'+q.label+(q.is_current?' ●':' ')+'</div>' +
				'<div class="crm-q-val">'+fmt(q.won_value)+'</div>' +
				'<div class="crm-q-sub">'+q.won_count+' deal'+(q.won_count!==1?'s':'')+' closed</div>' +
				'</div>';
		}).join('') || '<div class="crm-empty">No quarterly data</div>';
	};

	// ── Pipeline strip ────────────────────────────────────────────────

	CRMDashboard.prototype.render_pipeline = function () {
		var self=this;
		document.getElementById('crm-pipeline').innerHTML=this.funnel.map(function(row){
			return '<div class="crm-stage" style="border-top-color:'+self.stage_color(row.stage)+'">' +
				'<div class="crm-stage-name" title="'+row.stage+'">'+row.stage+'</div>' +
				'<div class="crm-stage-count">'+row.count+'</div>' +
				'<div class="crm-stage-val">'+fmt(row.value)+'</div></div>';
		}).join('')||'<div class="crm-empty">No data</div>';
	};

	// ── Monthly created ───────────────────────────────────────────────

	CRMDashboard.prototype.render_monthly_chart = function () {
		var ctx=document.getElementById('crm-monthly-chart');
		if(!ctx||!window.Chart||!this.monthly_trends.length) return;
		var labels=this.monthly_trends.map(function(m){return m.label;});
		this.charts['monthly']=new Chart(ctx,{
			type:'line',
			data:{labels:labels,datasets:[
				{label:'Opportunities',data:this.monthly_trends.map(function(m){return m.opps;}),
				 borderColor:C.blue,backgroundColor:'rgba(59,130,246,.08)',tension:.4,fill:true,pointRadius:3},
				{label:'Leads',data:this.monthly_trends.map(function(m){return m.leads;}),
				 borderColor:C.green,backgroundColor:'rgba(16,185,129,.08)',tension:.4,fill:true,pointRadius:3}
			]},
			options:{responsive:true,maintainAspectRatio:false,
				plugins:{legend:{position:'top',labels:{font:{size:11},boxWidth:12,usePointStyle:true}}},
				scales:{
					x:{ticks:{font:{size:9},maxRotation:35},grid:{display:false}},
					y:{ticks:{font:{size:10},stepSize:1,precision:0},grid:{color:'rgba(0,0,0,.05)'}}
				}}
		});
	};

	// ── Monthly won + lost ────────────────────────────────────────────

	CRMDashboard.prototype.render_revenue_chart = function () {
		var ctx=document.getElementById('crm-revenue-chart');
		if(!ctx||!window.Chart||!this.monthly_trends.length) return;
		var labels=this.monthly_trends.map(function(m){return m.label;});
		this.charts['revenue']=new Chart(ctx,{
			type:'bar',
			data:{labels:labels,datasets:[
				{label:'Won value (₹)',type:'bar',
				 data:this.monthly_trends.map(function(m){return m.won_value;}),
				 backgroundColor:'rgba(16,185,129,.75)',borderRadius:4,yAxisID:'y'},
				{label:'Won deals',type:'line',
				 data:this.monthly_trends.map(function(m){return m.won_count;}),
				 borderColor:C.green,backgroundColor:'transparent',tension:.4,pointRadius:4,yAxisID:'y1'},
				{label:'Lost deals',type:'line',
				 data:this.monthly_trends.map(function(m){return m.lost_count;}),
				 borderColor:C.red,backgroundColor:'transparent',tension:.4,pointRadius:4,
				 borderDash:[4,3],yAxisID:'y1'}
			]},
			options:{responsive:true,maintainAspectRatio:false,
				plugins:{legend:{position:'top',labels:{font:{size:11},boxWidth:12,usePointStyle:true}}},
				scales:{
					x:{ticks:{font:{size:9},maxRotation:35},grid:{display:false}},
					y: {position:'left', ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}},
					y1:{position:'right',ticks:{font:{size:9},stepSize:1,precision:0},grid:{display:false}}
				}}
		});
	};

	// ── Lead donut ────────────────────────────────────────────────────

	CRMDashboard.prototype.render_lead_chart = function () {
		var l=this.leads, statuses=this.lead_statuses;
		var colors=['#6B7280',C.blue,C.green,C.purple,C.pink,C.red,C.yellow,C.teal,C.indigo];
		var counts=statuses.map(function(s){return l.filter(function(x){return x.status===s;}).length;});
		var total=counts.reduce(function(a,b){return a+b;},0);
		var ctx=document.getElementById('crm-lead-chart');
		if(!ctx) return;
		if(total===0){ctx.parentElement.innerHTML='<div class="crm-section-title">Lead status distribution</div><div class="crm-empty">No leads in selected period</div>';return;}
		if(!window.Chart) return;
		var as=statuses.filter(function(s,i){return counts[i]>0;});
		var ac=counts.filter(function(c){return c>0;});
		var acol=as.map(function(_,i){return colors[i%colors.length];});
		this.charts['lead']=new Chart(ctx,{
			type:'doughnut',
			data:{labels:as,datasets:[{data:ac,backgroundColor:acol,borderWidth:2,hoverOffset:4}]},
			options:{responsive:true,maintainAspectRatio:false,
				plugins:{legend:{position:'right',labels:{font:{size:11},boxWidth:12,padding:10,usePointStyle:true}}}}
		});
	};

	// ── Revenue contribution donut (managers) ─────────────────────────

	CRMDashboard.prototype.render_revenue_donut = function () {
		var ctx=document.getElementById('crm-revenue-donut');
		if(!ctx||!window.Chart) return;
		var data=this.revenue_contribution.filter(function(r){return r.won_value>0;});
		if(!data.length){ctx.parentElement.innerHTML='<div class="crm-section-title">Revenue contribution by salesperson</div><div class="crm-empty">No won deals yet</div>';return;}
		var self=this;
		var total_rev = data.reduce(function(s,r){return s+r.won_value;},0);
		this.charts['rev_donut']=new Chart(ctx,{
			type:'doughnut',
			data:{
				labels:data.map(function(r){return self.sp_name(r.owner);}),
				datasets:[{
					data:data.map(function(r){return r.won_value;}),
					backgroundColor:data.map(function(_,i){return PALETTE[i%PALETTE.length];}),
					borderWidth:2,hoverOffset:6
				}]
			},
			options:{responsive:true,maintainAspectRatio:false,
				plugins:{
					legend:{position:'right',labels:{font:{size:11},boxWidth:12,padding:10,usePointStyle:true}},
					tooltip:{callbacks:{label:function(ctx){
						var pct = total_rev>0 ? Math.round((ctx.raw/total_rev)*100) : 0;
						return ' '+self.sp_name(data[ctx.dataIndex].owner)+': '+fmt(ctx.raw)+' ('+pct+'%)';
					}}}
				}
			}
		});
	};

	// ── Source chart ──────────────────────────────────────────────────

	CRMDashboard.prototype.render_source_chart = function () {
		var ctx=document.getElementById('crm-source-chart');
		if(!ctx||!window.Chart) return;
		var sel=this._src_selection;
		var stats=(sel?this.source_stats.filter(function(s){return sel.indexOf(s.source)!==-1;}):this.source_stats)
			.slice().sort(function(a,b){return (b.opportunities+b.leads)-(a.opportunities+a.leads);});
		if(!stats.length){ctx.style.display='none';return;}
		ctx.style.display='';
		if(this.charts['source']){this.charts['source'].destroy();delete this.charts['source'];}
		this.charts['source']=new Chart(ctx,{
			type:'bar',
			data:{
				labels:stats.map(function(s){return s.source.length>16?s.source.slice(0,16)+'…':s.source;}),
				datasets:[
					{label:'Opportunities',data:stats.map(function(s){return s.opportunities;}),backgroundColor:C.blue,borderRadius:4},
					{label:'Leads',data:stats.map(function(s){return s.leads;}),backgroundColor:C.green,borderRadius:4}
				]
			},
			options:{responsive:true,maintainAspectRatio:false,
				plugins:{legend:{position:'top',labels:{font:{size:11},boxWidth:12,usePointStyle:true}}},
				scales:{
					x:{ticks:{font:{size:9},maxRotation:40,autoSkip:false},grid:{display:false}},
					y:{ticks:{font:{size:10},stepSize:1,precision:0},grid:{color:'rgba(0,0,0,.05)'}}
				}}
		});
	};

	// ── Territory chart ───────────────────────────────────────────────

	CRMDashboard.prototype.render_territory = function () {
		var ctx=document.getElementById('crm-territory-chart');
		if(!ctx||!window.Chart) return;
		var sel=this._terr_selection;
		var stats=(sel?this.territory_stats.filter(function(t){return sel.indexOf(t.territory)!==-1;}):this.territory_stats)
			.slice().sort(function(a,b){return (b.opportunities+b.leads)-(a.opportunities+a.leads);});
		if(!stats.length){ctx.style.display='none';return;}
		ctx.style.display='';
		if(this.charts['territory']){this.charts['territory'].destroy();delete this.charts['territory'];}
		this.charts['territory']=new Chart(ctx,{
			type:'bar',
			data:{
				labels:stats.map(function(t){var n=t.territory||'-';return n.length>14?n.slice(0,14)+'…':n;}),
				datasets:[
					{label:'Opportunities',data:stats.map(function(t){return t.opportunities;}),backgroundColor:C.indigo,borderRadius:4},
					{label:'Leads',data:stats.map(function(t){return t.leads;}),backgroundColor:C.teal,borderRadius:4}
				]
			},
			options:{responsive:true,maintainAspectRatio:false,
				plugins:{legend:{position:'top',labels:{font:{size:11},boxWidth:12,usePointStyle:true}}},
				scales:{
					x:{ticks:{font:{size:10},maxRotation:35,autoSkip:false},grid:{display:false}},
					y:{ticks:{font:{size:10},stepSize:1,precision:0},grid:{color:'rgba(0,0,0,.05)'}}
				}}
		});
	};

	// ── Heatmap: Opp users vs stages (managers) ───────────────────────

	CRMDashboard.prototype.set_metric = function (m, btn, type) {
		if(type==='opp') this.metric=m;
		else if(type==='ms') this.ms_metric=m;
		document.querySelectorAll('.crm-toggle').forEach(function(b){b.classList.remove('active');});
		btn.classList.add('active');
		if(type==='opp') this.render_opp_heatmap();
		else             this.render_monthly_stage_heatmap();
	};

	CRMDashboard.prototype.hm_users = function () {
		if(!this.is_mgr) return [this.me];
		var seen={},result=[];
		this.salespersons.forEach(function(sp){if(sp.user&&!seen[sp.user]){seen[sp.user]=1;result.push(sp.user);}});
		this.opps.forEach(function(o){if(o.opportunity_owner&&!seen[o.opportunity_owner]){seen[o.opportunity_owner]=1;result.push(o.opportunity_owner);}});
		return result;
	};

	CRMDashboard.prototype.sp_name = function (u) {
		if(!u) return '-';
		var found=this.salespersons.filter(function(sp){return sp.user===u;});
		return found.length?(found[0].full_name||user_label(u)):user_label(u);
	};

	CRMDashboard.prototype._hm_table = function (rows_data, col_keys, row_key_fn, cell_fn, total_fn, legend_id) {
		// Generic heatmap table renderer
		var all_vals=[];
		rows_data.forEach(function(r){col_keys.forEach(function(c){all_vals.push(cell_fn(r,c,'val'));});});
		var max_v=Math.max.apply(null,all_vals.concat([1]));

		var html='<table class="crm-hm-table"><thead><tr><th class="row-h">'+row_key_fn('header')+'</th>';
		col_keys.forEach(function(c){html+='<th title="'+c+'">'+(c.length>9?c.slice(0,9)+'…':c)+'</th>';});
		html+='<th>Total</th></tr></thead><tbody>';

		rows_data.forEach(function(r){
			html+='<tr><th class="row-h">'+row_key_fn(r)+'</th>';
			var r_total=0;
			col_keys.forEach(function(c){
				var v=cell_fn(r,c,'val');
				r_total+=v;
				var t=v/max_v;
				var bg=hm_color(t);
				var tc=t>0.55?'#04342C':'inherit';
				var label=cell_fn(r,c,'label');
				var sub  =cell_fn(r,c,'sub');
				html+='<td><div class="crm-hm-cell" style="background:'+bg+';color:'+tc+'">' +
					'<div class="cv">'+label+'</div>'+(sub?'<div class="cs">'+sub+'</div>':'')+
					'</div></td>';
			});
			html+='<td class="crm-hm-total">'+total_fn(r,r_total)+'</td></tr>';
		});

		// Footer totals
		html+='<tr><td class="row-h crm-hm-footer">Total</td>';
		col_keys.forEach(function(c){
			var col_total=rows_data.reduce(function(s,r){return s+cell_fn(r,c,'val');},0);
			html+='<td class="crm-hm-footer" style="text-align:center">'+col_total+'</td>';
		});
		var grand=rows_data.reduce(function(s,r){
			return s+col_keys.reduce(function(s2,c){return s2+cell_fn(r,c,'val');},0);
		},0);
		html+='<td class="crm-hm-total crm-hm-footer">'+grand+'</td></tr>';
		html+='</tbody></table>';

		// Legend
		var strip='';
		for(var i=0;i<=16;i++) strip+='<div style="flex:1;background:'+hm_color(i/16)+'"></div>';
		var leg=document.getElementById(legend_id);
		if(leg) leg.innerHTML=strip;

		return html;
	};

	CRMDashboard.prototype.render_opp_heatmap = function () {
		var el=document.getElementById('crm-opp-heatmap');
		if(!el) return;
		var self=this,users=this.hm_users(),metric=this.metric||'count';
		if(!users.length||!self.stages.length){el.innerHTML='<div class="crm-empty">No data</div>';return;}

		el.innerHTML=this._hm_table(
			users,
			self.stages,
			function(r){return r==='header'?'User':self.sp_name(r);},
			function(u,s,mode){
				var items=self.opps.filter(function(o){return o.opportunity_owner===u&&o.sales_stage===s;});
				var c=items.length;
				var v=items.reduce(function(sum,o){return sum+(parseFloat(o.opportunity_amount)||0);},0);
				if(mode==='val') return metric==='value'?v:c;
				if(mode==='label') return metric==='value'?fmt(v):String(c);
				if(mode==='sub') return (metric==='both'&&c>0)?fmt(v):'';
			},
			function(u,total){return total+'<br><span>'+fmt(self.opps.filter(function(o){return o.opportunity_owner===u;}).reduce(function(s,o){return s+(parseFloat(o.opportunity_amount)||0);},0))+'</span>';},
			'crm-opp-hm-legend'
		);
	};

	CRMDashboard.prototype.render_lead_heatmap = function () {
		var el=document.getElementById('crm-lead-heatmap');
		if(!el) return;
		var self=this,data=this.lead_heatmap,statuses=this.lead_statuses;
		if(!data.length){el.innerHTML='<div class="crm-empty">No lead data</div>';return;}

		el.innerHTML=this._hm_table(
			data,
			statuses,
			function(r){return r==='header'?'User':self.sp_name(r.owner);},
			function(r,s,mode){
				if(r==='header') return 0;
				var c=r[s]||0;
				if(mode==='val') return c;
				if(mode==='label') return String(c);
				return '';
			},
			function(r,total){return String(total);},
			'crm-lead-hm-legend'
		);
	};

	// ── Monthly Stage Heatmap (Sales Users) ───────────────────────────

	CRMDashboard.prototype.render_monthly_stage_heatmap = function () {
		var self   = this;
		var el     = document.getElementById('crm-monthly-stage-heatmap');
		if (!el) return;
		var hm     = this.monthly_stage_heatmap;
		if (!hm||!hm.months||!hm.stages||!hm.matrix){
			el.innerHTML='<div class="crm-empty">No data</div>'; return;
		}
		var metric = this.ms_metric || 'count';
		var months = hm.months, stages = hm.stages, matrix = hm.matrix;

		// Populate user selector for managers (after first data load)
		if (this.is_mgr) {
			var sel = document.getElementById('mshm-user-sel');
			if (sel && sel.options.length <= 1 && this.salespersons.length) {
				var cur_val = sel.value;
				sel.innerHTML = '<option value="">All</option>';
				this.salespersons.forEach(function(sp){
					var opt = document.createElement('option');
					opt.value = sp.user;
					opt.textContent = sp.full_name || sp.user;
					sel.appendChild(opt);
				});
				if (cur_val) sel.value = cur_val;
				sel.onchange = function() {
					self._mshm_user = this.value || null;
					self.render_monthly_stage_heatmap();
				};
			}
		}

		// Get matrix for selected user (managers) or current user (sales user)
		// monthly_stage_heatmap from API is pre-filtered by role already
		// For manager user selector we need per-user data from target_actuals
		// Use the full matrix (already filtered by API per role)
		var use_matrix = matrix;

		// If manager selected a specific user, filter opps for that user
		if (this.is_mgr && this._mshm_user) {
			// Rebuild matrix from this.opps filtered to selected user
			use_matrix = {};
			stages.forEach(function(s){ use_matrix[s] = {}; months.forEach(function(m){ use_matrix[s][m]={count:0,value:0}; }); });
			this.opps.filter(function(o){ return o.opportunity_owner === self._mshm_user; }).forEach(function(o){
				var s = o.sales_stage; if (!s||!use_matrix[s]) return;
				try {
					var dt = new Date(o.transaction_date);
					var lbl = dt.toLocaleString('en-US',{month:'short'})+' '+dt.getFullYear();
					if (use_matrix[s][lbl]) {
						use_matrix[s][lbl].count++;
						use_matrix[s][lbl].value += parseFloat(o.opportunity_amount)||0;
					}
				} catch(e){}
			});
		}

		// Rows = stages, Columns = months
		var rows = stages.map(function(s){ return {stage:s}; });

		el.innerHTML = this._hm_table(
			rows, months,
			function(r){ return r==='header' ? 'Stage' : r.stage; },
			function(r, month, mode){
				if (r==='header') return 0;
				var cell = (use_matrix[r.stage]&&use_matrix[r.stage][month]) || {count:0,value:0};
				if (mode==='val')   return metric==='value' ? cell.value : cell.count;
				if (mode==='label') return metric==='value' ? fmt(cell.value) : String(cell.count);
				return '';
			},
			function(r, total){ return String(total); },
			'crm-mshm-legend'
		);
	};

	// ── Salesperson performance ───────────────────────────────────────

	CRMDashboard.prototype.render_sp_perf = function () {
		var self=this,container=document.getElementById('crm-sp-perf');
		if(!container) return;

		if(!this.is_mgr){
			var me=this.salesperson_stats.filter(function(s){return s.owner===self.me;})[0];
			if(!me){container.innerHTML='<div class="crm-empty">No data for selected period</div>';return;}
			var closed=(me.won||0)+(me.lost||0);
			var pct=closed>0?Math.round((me.won/closed)*100):0;
			container.innerHTML=
				'<div style="text-align:center;padding:20px 0">' +
				'<div style="font-size:36px;font-weight:800;color:#6366F1">'+(me.opportunities||0)+'</div>' +
				'<div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">My opportunities</div>' +
				'<div style="display:flex;gap:24px;justify-content:center;font-size:13px">' +
				'<span><b style="color:#10B981">'+(me.won||0)+'</b> Won</span>' +
				'<span><b style="color:#3B82F6">'+(me.pipeline||0)+'</b> Pipeline</span>' +
				'<span><b>'+fmt(me.pipeline_value||0)+'</b> Value</span></div>' +
				'<div style="margin-top:10px;font-size:13px;color:var(--text-muted)">'+pct+'% conv. rate</div></div>';
			return;
		}

		if(!this.salesperson_stats.length){container.innerHTML='<div class="crm-empty">No data</div>';return;}

		container.innerHTML=this.salesperson_stats.map(function(sp){
			var closed=(sp.won||0)+(sp.lost||0);
			var pct=closed>0?Math.round((sp.won/closed)*100):0;
			var bc=pct>=60?'#10B981':pct>=30?'#3B82F6':'#EF4444';
			var name=self.sp_name(sp.owner);
			var init=name.split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase();
			return '<div class="crm-sp-row">' +
				'<div class="crm-sp-info">' +
				'<div class="crm-avatar">'+init+'</div>' +
				'<div><div style="font-size:13px;font-weight:600">'+name+'</div>' +
				'<div style="font-size:11px;color:var(--text-muted);margin-top:2px">'+(sp.won||0)+' won · '+(sp.pipeline||0)+' pipeline</div>' +
				'<div class="crm-progress" style="width:140px"><div class="crm-progress-fill" style="width:'+pct+'%;background:'+bc+'"></div></div></div></div>' +
				'<div style="text-align:right">' +
				'<div style="font-size:13px;font-weight:700">'+fmt(sp.pipeline_value||0)+'</div>' +
				'<div style="font-size:11px;color:var(--text-muted)">'+pct+'% conv.</div></div></div>';
		}).join('');
	};

	// ── Multi-select helpers ──────────────────────────────────────────

	CRMDashboard.prototype._build_multiselect = function (key, items, current_selection) {
		var self=this,list_el=document.getElementById(key+'-ms-list'),
		    search_el=document.getElementById(key+'-ms-search'),
		    btn_el=document.getElementById(key+'-ms-btn'),
		    dd_el=document.getElementById(key+'-ms-dropdown');
		if(!list_el||!btn_el) return;
		this['_ms_items_'+key]=items;
		btn_el.onclick=function(e){e.stopPropagation();dd_el.classList.toggle('open');if(dd_el.classList.contains('open')&&search_el)search_el.focus();};
		if(search_el) search_el.oninput=function(){var q=this.value.toLowerCase();Array.from(list_el.querySelectorAll('.crm-ms-item')).forEach(function(item){item.style.display=item.textContent.toLowerCase().includes(q)?'':'none';});};
		this._render_ms_list(key, current_selection);
		this._update_ms_label(key, items, current_selection);
	};

	CRMDashboard.prototype._render_ms_list = function (key, selection) {
		var items=this['_ms_items_'+key]||[];
		var el=document.getElementById(key+'-ms-list');
		if(!el) return;
		el.innerHTML=items.map(function(item){
			var checked=!selection||selection.indexOf(item)!==-1;
			return '<label class="crm-ms-item"><input type="checkbox" value="'+item+'" '+(checked?'checked':'')+'>'+
				'<span>'+item+'</span></label>';
		}).join('');
	};

	CRMDashboard.prototype._update_ms_label = function (key, items, selection) {
		var el=document.getElementById(key+'-ms-label');
		if(!el) return;
		if(!selection||selection.length===items.length) el.textContent='All '+(key==='src'?'sources':'territories');
		else if(!selection.length) el.textContent='None selected';
		else el.textContent=selection.length+' selected';
	};

	CRMDashboard.prototype._ms_select_all = function (key) {
		var el=document.getElementById(key+'-ms-list');
		if(el) el.querySelectorAll('input').forEach(function(cb){cb.checked=true;});
	};

	CRMDashboard.prototype._ms_clear_all = function (key) {
		var el=document.getElementById(key+'-ms-list');
		if(el) el.querySelectorAll('input').forEach(function(cb){cb.checked=false;});
	};

	CRMDashboard.prototype._ms_apply = function (key) {
		var items=this['_ms_items_'+key]||[];
		var el=document.getElementById(key+'-ms-list');
		if(!el) return;
		var checked=Array.from(el.querySelectorAll('input:checked')).map(function(cb){return cb.value;});
		var selection=checked.length===items.length?null:checked;
		if(key==='src'){
			this._src_selection=selection;
			if(this.charts['source']){this.charts['source'].destroy();delete this.charts['source'];}
			this.render_source_chart();
		} else {
			this._terr_selection=selection;
			if(this.charts['territory']){this.charts['territory'].destroy();delete this.charts['territory'];}
			this.render_territory();
		}
		this._update_ms_label(key,items,checked);
		document.getElementById(key+'-ms-dropdown').classList.remove('open');
	};


	registerPage();
})();
