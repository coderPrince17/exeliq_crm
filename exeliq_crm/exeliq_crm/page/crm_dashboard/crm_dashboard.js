// Exeliq CRM Dashboard — standard Frappe page lifecycle (no polling, no set_route)
frappe.pages['crm-dashboard'].on_page_load = function (wrapper) {
	loadChartJS(function () {
		if (frappe.crm_dashboard) { frappe.crm_dashboard.destroy_charts(); }
		var page = frappe.ui.make_app_page({
			parent: wrapper, title: 'CRM Pipeline Dashboard', single_column: true
		});
		frappe.crm_dashboard = new CRMDashboard(page);
	});
};

	function loadChartJS(cb) {
		if (window.Chart) { cb(); return; }
		var s = document.createElement('script');
		s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
		s.onload = cb; s.onerror = cb;
		document.head.appendChild(s);
	}

	function initDashboard(wrapper) {
                if (!wrapper || !wrapper.appendChild) {
                        wrapper = document.querySelector('#page-crm-dashboard')
                               || document.querySelector('[data-page-route="crm-dashboard"]')
                               || (cur_page && cur_page.page && cur_page.page.wrapper);
                }
                if (!wrapper || !wrapper.appendChild) {
                        setTimeout(function () { initDashboard(); }, 150);
                        return;
                }
                if (frappe.crm_dashboard) { frappe.crm_dashboard.destroy_charts(); }
                var page = frappe.ui.make_app_page({
                        parent: wrapper, title: 'CRM Pipeline Dashboard', single_column: true
                });
                frappe.crm_dashboard = new CRMDashboard(page);
        }

	// ── Helpers ───────────────────────────────────────────────────────

	function fmt(v) {
		v = parseFloat(v) || 0;
		if (v >= 10000000) return '\u20B9' + (v/10000000).toFixed(2) + ' Cr';
		if (v >= 100000)   return '\u20B9' + (v/100000).toFixed(2) + 'L';
		if (v >= 1000)     return '\u20B9' + (v/1000).toFixed(2) + 'K';
		return v > 0 ? '\u20B9' + v.toFixed(2) : '\u20B90.00';
	}

	function user_label(u) {
		if (!u) return '-';
		var p = u.indexOf('@') !== -1 ? u.split('@')[0] : u;
		return p.replace(/[._]/g, ' ').replace(/\b\w/g, function(c){return c.toUpperCase();});
	}

	function hm_color(t) {
		return 'rgb('+Math.round(225+t*(8-225))+','+Math.round(245+t*(110-245))+','+Math.round(238+t*(72-238))+')';
	}

	var PALETTE = ['#6366F1','#10B981','#F59E0B','#EF4444','#3B82F6',
	               '#8B5CF6','#EC4899','#14B8A6','#F97316','#84CC16',
	               '#06B6D4','#A855F7','#D946EF','#0EA5E9','#22C55E'];
	var C = {blue:'#3B82F6',green:'#10B981',purple:'#8B5CF6',orange:'#F97316',
	         red:'#EF4444',teal:'#14B8A6',indigo:'#6366F1',pink:'#EC4899',
	         yellow:'#F59E0B',cyan:'#06B6D4'};

	var WON  = 'Closed Won';
	var LOST = 'Closed Lost';

	// ── CRMDashboard ──────────────────────────────────────────────────

	function CRMDashboard(page) {
		this.page    = page;
		this.is_mgr  = frappe.user.has_role('Sales Manager') || frappe.user.has_role('System Manager');
		this.me      = frappe.session.user;
		this.metric  = 'count';
		this.ms_metric = 'count';
		this.charts  = {};
		this.loading = false;
		this.pending = false;
		this.initializing = true;
		this._updating_sp = false;
		this._mshm_user   = null;
		this._terr_sel    = null;
		this._src_sel     = null;

		// Data
		this.opps = []; this.leads = []; this.stages = []; this.stage_map = {};
		this.lead_statuses = []; this.salespersons = []; this.kpis = {};
		this.funnel = []; this.territory_stats = []; this.salesperson_stats = [];
		this.monthly_trends = []; this.source_stats = []; this.fiscal_years = {};
		this.quarterly_revenue = []; this.lead_heatmap = [];
		this.monthly_stage_heatmap = {}; this.revenue_contribution = [];

		this.setup_html();
		this.setup_filters();
		this.mount_filters();
		this.initializing = false;
		this.load_data();
	}

	// ── CSS ───────────────────────────────────────────────────────────

	var CSS = '<style>' +
	'.crm-dash{padding:8px 4px 24px}' +
	'.crm-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:14px}' +
	'.crm-metric{background:var(--fg-color);border:1px solid var(--border-color);border-radius:10px;padding:16px 18px;position:relative;overflow:hidden}' +
	'.crm-metric::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:var(--ma,#6366F1)}' +
	'.crm-metric-label{font-size:10px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;font-weight:600}' +
	'.crm-metric-val{font-size:24px;font-weight:700;color:var(--text-color);line-height:1.1}' +
	'.crm-metric-sub{font-size:11px;color:var(--text-muted);margin-top:5px}' +
	'.crm-metric-val.green{color:#10B981}.crm-metric-val.red{color:#EF4444}' +
	'.crm-quarterly{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:0}' +
	'@media(max-width:700px){.crm-quarterly{grid-template-columns:repeat(2,1fr)}}' +
	'.crm-q-card{background:var(--fg-color);border:1px solid var(--border-color);border-radius:10px;padding:14px 16px;position:relative;overflow:hidden}' +
	'.crm-q-card::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:var(--qa,#6366F1)}' +
	'.crm-q-card.cur{border-color:#6366F1;box-shadow:0 0 0 1px #6366F1}' +
	'.crm-q-label{font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}' +
	'.crm-q-val{font-size:20px;font-weight:700;color:#10B981}' +
	'.crm-q-sub{font-size:11px;color:var(--text-muted);margin-top:4px}' +
	'.crm-card{background:var(--fg-color);border:1px solid var(--border-color);border-radius:10px;padding:18px;margin-bottom:18px}' +
	'.crm-section-title{font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:14px}' +
	'.crm-two-col{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px}' +
	'@media(max-width:800px){.crm-two-col{grid-template-columns:1fr}}' +
	'.crm-pipeline{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px}' +
	'.crm-pipeline::-webkit-scrollbar{height:4px}' +
	'.crm-pipeline::-webkit-scrollbar-thumb{background:#6366F1;border-radius:2px}' +
	'.crm-stage{flex:0 0 auto;min-width:150px;border:1px solid var(--border-color);border-radius:10px;padding:18px 20px;border-top:4px solid #888;transition:box-shadow .2s}' +
	'.crm-stage:hover{box-shadow:0 4px 12px rgba(0,0,0,.08)}' +
	'.crm-stage-name{font-size:11px;color:var(--text-muted);margin-bottom:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}' +
	'.crm-stage-count{font-size:36px;font-weight:800;color:var(--text-color);line-height:1}' +
	'.crm-stage-val{font-size:13px;color:var(--text-muted);margin-top:6px;font-weight:500}' +
	'.crm-chart-filter{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}' +
	'.crm-chart-filter label{font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;white-space:nowrap}' +
	'.crm-ms-wrap{position:relative;flex:1;min-width:180px}' +
	'.crm-ms-btn{width:100%;padding:5px 10px;font-size:12px;border:1px solid var(--border-color);border-radius:6px;background:var(--fg-color);color:var(--text-color);cursor:pointer;text-align:left;display:flex;justify-content:space-between;align-items:center}' +
	'.crm-ms-dd{display:none;position:absolute;top:100%;left:0;right:0;background:var(--fg-color);border:1px solid var(--border-color);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:1000;max-height:260px;overflow:hidden;margin-top:3px;flex-direction:column}' +
	'.crm-ms-dd.open{display:flex}' +
	'.crm-ms-search{padding:8px;border-bottom:1px solid var(--border-color)}' +
	'.crm-ms-search input{width:100%;padding:5px 8px;font-size:12px;border:1px solid var(--border-color);border-radius:4px;background:var(--fg-color);color:var(--text-color);outline:none}' +
	'.crm-ms-list{overflow-y:auto;max-height:180px}' +
	'.crm-ms-item{display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;font-size:12px}' +
	'.crm-ms-item:hover{background:rgba(99,102,241,.06)}' +
	'.crm-ms-item input[type=checkbox]{margin:0;cursor:pointer;accent-color:#6366F1}' +
	'.crm-ms-footer{padding:6px 10px;border-top:1px solid var(--border-color);display:flex;gap:6px}' +
	'.crm-ms-footer button{font-size:11px;padding:3px 10px;border-radius:4px;border:1px solid var(--border-color);cursor:pointer;background:var(--fg-color)}' +
	'.crm-ms-footer button.primary{background:#6366F1;color:#fff;border-color:#6366F1}' +
	'.crm-hm-wrap{overflow-x:auto}' +
	'.crm-hm-table{width:100%;border-collapse:separate;border-spacing:3px;min-width:600px;font-size:11px}' +
	'.crm-hm-table th{color:var(--text-muted);padding:4px 6px;text-align:center;font-weight:500;white-space:nowrap}' +
	'.crm-hm-table th.row-h{text-align:left;min-width:120px;font-size:12px;font-weight:600}' +
	'.crm-hm-cell{border-radius:5px;padding:7px 3px;text-align:center}' +
	'.crm-hm-cell .cv{font-size:12px;font-weight:700}' +
	'.crm-hm-cell .cs{font-size:9px;margin-top:1px;opacity:.85}' +
	'.crm-hm-total{font-size:12px;font-weight:700;padding:4px 8px;text-align:center;color:var(--text-muted)}' +
	'.crm-hm-total span{font-size:10px;font-weight:400}' +
	'.crm-hm-footer{color:var(--text-muted)!important;font-weight:400!important;font-size:11px!important;padding:3px 6px!important}' +
	'.crm-toggle-row{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;align-items:center}' +
	'.crm-toggle{font-size:12px;padding:5px 14px;border-radius:6px;border:1px solid var(--border-color);background:var(--fg-color);color:var(--text-muted);cursor:pointer;font-weight:500}' +
	'.crm-toggle.active{background:#EEF2FF;color:#6366F1;border-color:#6366F1}' +
	'.crm-legend{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;color:var(--text-muted)}' +
	'.crm-legend-strip{display:flex;height:8px;width:120px;border-radius:4px;overflow:hidden}' +
	'.crm-sp-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border-color)}' +
	'.crm-sp-row:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}' +
	'.crm-sp-info{display:flex;align-items:center;gap:10px}' +
	'.crm-avatar{width:36px;height:36px;border-radius:50%;background:#EEF2FF;color:#6366F1;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}' +
	'.crm-progress{height:4px;background:var(--border-color);border-radius:2px;margin-top:6px}' +
	'.crm-progress-fill{height:100%;border-radius:2px;transition:width .4s}' +
	'.crm-empty{text-align:center;padding:36px;color:var(--text-muted);font-size:13px}' +
	'.crm-user-sel{font-size:12px;padding:4px 8px;border:1px solid var(--border-color);border-radius:5px;background:var(--fg-color);color:var(--text-color);margin-left:8px}' +
	'</style>';

	// ── HTML Builder — no template literals with mgr conditions ───────

	CRMDashboard.prototype.setup_html = function () {
		var self = this;
		var mgr  = this.is_mgr;

		// Build manager-only heatmap section using string concat
		var opp_hm_html = mgr ? (
			'<div class="crm-card">' +
			'<div class="crm-section-title">Opportunities created \u2014 users vs months</div>' +
			'<div class="crm-hm-wrap"><div id="crm-opp-heatmap"></div></div>' +
			'<div class="crm-legend"><span>Low</span><div class="crm-legend-strip" id="crm-opp-hm-legend"></div><span>High</span></div>' +
			'</div>' +
			'<div class="crm-card">' +
			'<div class="crm-section-title">Leads created \u2014 users vs months</div>' +
			'<div class="crm-hm-wrap"><div id="crm-lead-heatmap"></div></div>' +
			'<div class="crm-legend"><span>Low</span><div class="crm-legend-strip" id="crm-lead-hm-legend"></div><span>High</span></div>' +
			'</div>'
		) : '';

		var mshm_user_sel = mgr ? (
			'<div style="margin-left:auto;display:flex;align-items:center;gap:6px">' +
			'<label style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase">User</label>' +
			'<select id="mshm-user-sel" class="crm-user-sel"><option value="">All</option></select>' +
			'</div>'
		) : '';

		// Revenue donut — managers only
		var rev_donut_html = mgr ? (
			'<div class="crm-card">' +
			'<div class="crm-section-title">Revenue contribution by salesperson</div>' +
			'<div style="position:relative;height:240px"><canvas id="crm-revenue-donut"></canvas></div>' +
			'</div>'
		) : (
			'<div class="crm-card">' +
			'<div class="crm-section-title">Source distribution</div>' +
			'<div class="crm-chart-filter"><label>Filter</label>' +
			'<div class="crm-ms-wrap" id="src-ms-wrap">' +
			'<button class="crm-ms-btn" id="src-ms-btn"><span id="src-ms-label">All sources</span><span>\u25BE</span></button>' +
			'<div class="crm-ms-dd" id="src-ms-dd">' +
			'<div class="crm-ms-search"><input type="text" id="src-ms-search" placeholder="Search\u2026"></div>' +
			'<div class="crm-ms-list" id="src-ms-list"></div>' +
			'<div class="crm-ms-footer">' +
			'<button onclick="frappe.crm_dashboard._ms_all(\'src\')">All</button>' +
			'<button onclick="frappe.crm_dashboard._ms_none(\'src\')">None</button>' +
			'<button class="primary" onclick="frappe.crm_dashboard._ms_apply(\'src\')">Apply</button>' +
			'</div></div></div></div>' +
			'<div style="position:relative;height:190px"><canvas id="crm-source-chart"></canvas></div>' +
			'</div>'
		);

		// Territory — managers only
		var terr_html = mgr ? (
			'<div class="crm-card">' +
			'<div class="crm-section-title">Territory distribution</div>' +
			'<div class="crm-chart-filter"><label>Filter</label>' +
			'<div class="crm-ms-wrap" id="terr-ms-wrap">' +
			'<button class="crm-ms-btn" id="terr-ms-btn"><span id="terr-ms-label">All territories</span><span>\u25BE</span></button>' +
			'<div class="crm-ms-dd" id="terr-ms-dd">' +
			'<div class="crm-ms-search"><input type="text" id="terr-ms-search" placeholder="Search\u2026"></div>' +
			'<div class="crm-ms-list" id="terr-ms-list"></div>' +
			'<div class="crm-ms-footer">' +
			'<button onclick="frappe.crm_dashboard._ms_all(\'terr\')">All</button>' +
			'<button onclick="frappe.crm_dashboard._ms_none(\'terr\')">None</button>' +
			'<button class="primary" onclick="frappe.crm_dashboard._ms_apply(\'terr\')">Apply</button>' +
			'</div></div></div></div>' +
			'<div style="position:relative;height:190px"><canvas id="crm-territory-chart"></canvas></div>' +
			'</div>'
		) : '';

		// Source for managers
		var src_mgr_html = mgr ? (
			'<div class="crm-card">' +
			'<div class="crm-section-title">Source distribution</div>' +
			'<div class="crm-chart-filter"><label>Filter</label>' +
			'<div class="crm-ms-wrap" id="src-ms-wrap">' +
			'<button class="crm-ms-btn" id="src-ms-btn"><span id="src-ms-label">All sources</span><span>\u25BE</span></button>' +
			'<div class="crm-ms-dd" id="src-ms-dd">' +
			'<div class="crm-ms-search"><input type="text" id="src-ms-search" placeholder="Search\u2026"></div>' +
			'<div class="crm-ms-list" id="src-ms-list"></div>' +
			'<div class="crm-ms-footer">' +
			'<button onclick="frappe.crm_dashboard._ms_all(\'src\')">All</button>' +
			'<button onclick="frappe.crm_dashboard._ms_none(\'src\')">None</button>' +
			'<button class="primary" onclick="frappe.crm_dashboard._ms_apply(\'src\')">Apply</button>' +
			'</div></div></div></div>' +
			'<div style="position:relative;height:190px"><canvas id="crm-source-chart"></canvas></div>' +
			'</div>'
		) : '';

		var html = CSS +
		'<div class="crm-dash">' +

		// Metrics
		'<div id="crm-metrics" class="crm-metrics">' +
		'<div class="crm-metric"><div class="crm-metric-label">Loading\u2026</div></div>' +
		'</div>' +

		// Quarterly cards — all users
		'<div class="crm-card">' +
		'<div class="crm-section-title">Quarterly revenue \u2014 current fiscal year</div>' +
		'<div id="crm-quarterly" class="crm-quarterly"></div>' +
		'</div>' +

		// Pipeline
		'<div class="crm-card">' +
		'<div class="crm-section-title">Pipeline by stage</div>' +
		'<div id="crm-pipeline" class="crm-pipeline"></div>' +
		'</div>' +

		// Monthly charts
		'<div class="crm-two-col">' +
		'<div class="crm-card">' +
		'<div class="crm-section-title">Monthly opportunities &amp; leads created</div>' +
		'<div style="position:relative;height:220px"><canvas id="crm-monthly-chart"></canvas></div>' +
		'</div>' +
		'<div class="crm-card">' +
		'<div class="crm-section-title">Monthly won &amp; lost \u2014 deals &amp; revenue</div>' +
		'<div style="position:relative;height:220px"><canvas id="crm-revenue-chart"></canvas></div>' +
		'</div>' +
		'</div>' +

		// Lead status + revenue donut OR source (non-mgr)
		'<div class="crm-two-col">' +
		'<div class="crm-card">' +
		'<div class="crm-section-title">Lead status distribution</div>' +
		'<div id="crm-lead-status-wrap" style="position:relative;height:240px"><canvas id="crm-lead-chart"></canvas></div>' +
		'</div>' +
		rev_donut_html +
		'</div>' +

		// Source + Territory (managers) OR nothing (sales user - source already above)
		(mgr ? (
		'<div class="crm-two-col">' +
		src_mgr_html +
		terr_html +
		'</div>'
		) : '') +

		// Manager heatmaps (opp + lead)
		opp_hm_html +

		// Monthly stage heatmap — all users
		'<div class="crm-card">' +
		'<div class="crm-section-title">Pipeline \u2014 months vs stages</div>' +
		'<div class="crm-toggle-row">' +
		'<button class="crm-toggle active" id="mshm-count">Deal count</button>' +
		'<button class="crm-toggle" id="mshm-value">Deal value (\u20B9)</button>' +
		mshm_user_sel +
		'</div>' +
		'<div class="crm-hm-wrap"><div id="crm-monthly-stage-heatmap"></div></div>' +
		'<div class="crm-legend"><span>Low</span><div class="crm-legend-strip" id="crm-mshm-legend"></div><span>High</span></div>' +
		'</div>' +

		// Salesperson performance
		'<div class="crm-card">' +
		'<div class="crm-section-title">Salesperson performance</div>' +
		'<div id="crm-sp-perf" style="overflow-y:auto;max-height:320px"></div>' +
		'</div>' +

		'</div>'; // .crm-dash

		this.page.main.html(html);

		// Wire toggles
		document.getElementById('mshm-count').onclick = function(){ self.set_metric('count',this,'ms'); };
		document.getElementById('mshm-value').onclick = function(){ self.set_metric('value',this,'ms'); };

		// Close multiselect on outside click
		document.addEventListener('click', function(e){
			['src','terr'].forEach(function(k){
				var w = document.getElementById(k+'-ms-wrap');
				var d = document.getElementById(k+'-ms-dd');
				if (w && d && !w.contains(e.target)) d.classList.remove('open');
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
			change: function(){
				if(self.initializing||self._updating_sp) return;
				var p=self.f_period.get_value();
				if(p==='Custom') return;
				var d=self.period_dates(p);
				if(d){ self.f_from.set_value(d[0]); self.f_to.set_value(d[1]); }
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

		this.page.add_inner_button('Refresh', function(){ self.load_data(); });
	};

	CRMDashboard.prototype.mount_filters = function () {
		var self = this;
		// The page_form created by make_app_page is DETACHED (no parent). It must be
		// appended into the visible page head, or the filters never render. The old
		// code did this but ran once, before the head existed on soft-nav (hence
		// 'filters only on hard refresh'). We retry until both the form and a target
		// head container are ready, then attach exactly once.
		var tries = 0;
		function attach() {
			tries++;
			var pf = self.page && self.page.page_form;
			if (!pf || !pf.length) { if (tries < 50) setTimeout(attach, 100); return; }

			// Prefer this page's own head container; fall back to the route page head.
			var hc = (self.page.page_head && self.page.page_head.find('.container')[0])
			      || document.querySelector('#page-crm-dashboard .page-head .container')
			      || document.querySelector('.page-head .container');
			if (!hc) { if (tries < 50) setTimeout(attach, 100); return; }

			// Remove any stale filter row from a previous init (avoids duplicates).
			var stale = hc.querySelectorAll('.page-form.row');
			for (var i = 0; i < stale.length; i++) {
				if (stale[i] !== pf[0] && stale[i].id !== 'crm-pf') {
					if (stale[i].parentElement) stale[i].parentElement.removeChild(stale[i]);
				}
			}
			if (pf[0].parentElement !== hc) {
				pf[0].id = 'crm-pf';
				hc.appendChild(pf[0]);
			}
			pf.removeClass('hide');
		}
		attach();

		var st = document.getElementById('crm-pf-css') || document.createElement('style');
		st.id = 'crm-pf-css';
		st.textContent =
			'.page-form.row{' +
			'display:flex!important;flex-wrap:wrap!important;gap:8px!important;' +
			'padding:8px 0!important;align-items:flex-end!important;width:100%!important;' +
			'position:relative!important;border-top:1px solid var(--border-color)!important;' +
			'margin-top:4px!important;clear:both!important;}' +
			'.page-form.row > .frappe-control{flex:0 0 auto!important;width:auto!important;max-width:none!important;min-width:150px!important;margin:0!important;padding:0!important}' +
			'.page-form.row .form-group{margin-bottom:0!important}' +
			'.page-form.row .btn{align-self:flex-end!important}' +
			'#page-crm-dashboard .layout-main-section{padding-top:0!important}';
		if (!st.parentElement) document.head.appendChild(st);
	};

	CRMDashboard.prototype.period_dates = function (p) {
		var now = frappe.datetime.now_date();
		if (p==='Today')        return [now, now];
		if (p==='This Week')    return [frappe.datetime.week_start(), now];
		if (p==='This Month')   return [frappe.datetime.month_start(), now];
		if (p==='This Quarter') return [frappe.datetime.quarter_start(), now];
		if (p==='This Year')    return [frappe.datetime.year_start(), now];
		if (p==='This FY') {
			var fy=this.fiscal_years&&this.fiscal_years.current;
			return fy ? [fy.from, fy.to] : [frappe.datetime.year_start(), now];
		}
		if (p==='Last FY') {
			var lfy=this.fiscal_years&&this.fiscal_years.last;
			return lfy ? [lfy.from, lfy.to] : null;
		}
		if (p==='Last Month') {
			var d=frappe.datetime.str_to_obj(frappe.datetime.month_start());
			d.setDate(d.getDate()-1); var e=frappe.datetime.obj_to_str(d); d.setDate(1);
			return [frappe.datetime.obj_to_str(d), e];
		}
		if (p==='Last Quarter') {
			var qs=frappe.datetime.str_to_obj(frappe.datetime.quarter_start());
			qs.setDate(qs.getDate()-1); var qe=frappe.datetime.obj_to_str(qs);
			var qm=new Date(qs); qm.setMonth(qm.getMonth()-2); qm.setDate(1);
			return [frappe.datetime.obj_to_str(qm), qe];
		}
		return [frappe.datetime.month_start(), now];
	};

	CRMDashboard.prototype.get_f = function () {
		return {
			from: (this.f_from&&this.f_from.get_value()) || frappe.datetime.month_start(),
			to:   (this.f_to&&this.f_to.get_value())     || frappe.datetime.now_date(),
			sp:   (this.is_mgr&&this.f_sp&&this.f_sp.get_value()!=='All') ? this.f_sp.get_value() : null
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
		if(this.loading){this.pending=true;return;}
		this.loading=true;
		var f=this.get_f();
		this.destroy_charts();
		document.getElementById('crm-metrics').innerHTML=
			'<div class="crm-metric"><div class="crm-metric-label">Loading\u2026</div></div>';

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
				self.opps              = d.opportunities||[];
				self.leads             = d.leads||[];
					self.lead_status_leads = d.lead_status_leads || d.leads || [];
				self.kpis              = d.kpis||{};
				self.territory_stats   = d.territory_stats||[];
				self.salesperson_stats = d.salesperson_stats||[];
				self.salespersons      = d.salespersons||[];
				self.monthly_trends    = d.monthly_trends||[];
				self.source_stats      = d.source_stats||[];
				self.fiscal_years      = d.fiscal_years||{};
				self.quarterly_revenue = d.quarterly_revenue||[];
				self.lead_heatmap      = d.lead_heatmap||[];
				self.monthly_stage_heatmap = d.monthly_stage_heatmap||{};
				self.opp_user_month_heatmap  = d.opp_user_month_heatmap||{};
				self.lead_user_month_heatmap = d.lead_user_month_heatmap||{};
				self.revenue_contribution  = d.revenue_contribution||[];
				self.lead_statuses     = d.lead_statuses||['Lead','Open','Replied','Opportunity',
				                         'Quotation','Lost Quotation','Interested','Converted','Do Not Contact'];

				self.stages=(d.sales_stages||[]).map(function(s){return s.label||s.name;});
				self.stage_map={};
				self.stages.forEach(function(s,i){self.stage_map[s]=PALETTE[i%PALETTE.length];});

				var fd=d.funnel||{};
				self.funnel=self.stages.map(function(s){
					var r=fd[s]||{count:0,value:0};
					return {stage:s,count:r.count,value:r.value};
				});

				// Update SP dropdown
				if(self.f_sp&&self.salespersons.length){
					self._updating_sp=true;
					var cur=self.f_sp.get_value();
					self.f_sp.df.options=['All'].concat(self.salespersons.map(function(sp){return sp.user;})).join('\n');
					self.f_sp.refresh();
					var sel=self.f_sp.$wrapper&&self.f_sp.$wrapper[0]&&self.f_sp.$wrapper[0].querySelector('select');
					if(sel){Array.from(sel.options).forEach(function(o){
						if(!o.value||o.value==='All') return;
						var sp=self.salespersons.filter(function(s){return s.user===o.value;})[0];
						if(sp&&sp.full_name) o.text=sp.full_name;
					});}
					if(cur&&cur!=='All') self.f_sp.set_value(cur);
					setTimeout(function(){self._updating_sp=false;},200);
				}

				// Build multiselect items
				self._ms_items_src  = (self.source_stats||[]).map(function(s){return s.source;}).filter(Boolean).sort();
				self._ms_items_terr = (self.territory_stats||[]).map(function(t){return t.territory;}).filter(Boolean).sort();
				self._build_ms('src',  self._ms_items_src,  self._src_sel);
				self._build_ms('terr', self._ms_items_terr, self._terr_sel);

				self.render_all();
				if(self.pending){self.pending=false;self.load_data();}
			},
			error:function(e){
				self.loading=false;
				document.getElementById('crm-metrics').innerHTML=
					'<div style="color:#EF4444;padding:10px">Error loading data.</div>';
				console.error('CRM:',e);
			}
		});
	};

	// ── Render ────────────────────────────────────────────────────────

	CRMDashboard.prototype.render_all = function () {
		this.render_metrics();
		this.render_quarterly();
		this.render_pipeline();
		this.render_monthly_chart();
		this.render_revenue_chart();
		this.render_lead_chart();
		if (this.is_mgr) {
			this.render_revenue_donut();
			this.render_source_chart();
			this.render_territory();
			this.render_opp_heatmap();
			this.render_lead_heatmap();
		} else {
			this.render_source_chart();
		}
		this.render_monthly_stage_heatmap();
		this.render_sp_perf();
	};

	CRMDashboard.prototype.sc = function(s){ return this.stage_map[s]||'#6366F1'; };

	// ── Metrics ───────────────────────────────────────────────────────

	CRMDashboard.prototype.render_metrics = function () {
		var k=this.kpis, conv=parseFloat(k.conversion)||0;
		var acc=['#6366F1','#3B82F6','#8B5CF6','#10B981','#EF4444','#F59E0B','#14B8A6'];
		var cards=[
			['Total Leads',    k.total_leads||0,           'In selected period',              '',                          acc[0]],
			['Opportunities',  k.total_opportunities||0,   (k.pipeline_count||0)+' pipeline', '',                          acc[1]],
			['Pipeline Value', fmt(k.pipeline_value||0),   'Excl. Won & Lost',                '',                          acc[2]],
			['Closed Won',     fmt(k.won_value||0),        (k.won_count||0)+' deals',         'green',                     acc[3]],
			['Closed Lost',    k.lost_count||0,            fmt(k.lost_value||0),              'red',                       acc[4]],
			['Conv. Rate',     conv+'%',                   'Won / (Won+Lost)',                 conv>=30?'green':'red',      acc[5]],
			['Avg Deal Size',  fmt(k.average_deal_size||0),'Per won deal',                    '',                          acc[6]]
		];
		document.getElementById('crm-metrics').innerHTML=cards.map(function(c){
			return '<div class="crm-metric" style="--ma:'+c[4]+'">' +
				'<div class="crm-metric-label">'+c[0]+'</div>' +
				'<div class="crm-metric-val '+c[3]+'">'+c[1]+'</div>' +
				'<div class="crm-metric-sub">'+c[2]+'</div></div>';
		}).join('');
	};

	// ── Quarterly ─────────────────────────────────────────────────────

	CRMDashboard.prototype.render_quarterly = function () {
		var el=document.getElementById('crm-quarterly');
		if(!el) return;
		var qc=['#6366F1','#10B981','#F97316','#8B5CF6'];
		el.innerHTML=this.quarterly_revenue.map(function(q,i){
			return '<div class="crm-q-card'+(q.is_current?' cur':'')+'" style="--qa:'+qc[i%4]+'">' +
				'<div class="crm-q-label">'+q.label+(q.is_current?' \u25CF':'')+'</div>' +
				'<div class="crm-q-val">'+fmt(q.won_value)+'</div>' +
				'<div class="crm-q-sub">'+q.won_count+' deal'+(q.won_count!==1?'s':'')+' closed</div>' +
				'</div>';
		}).join('')||'<div class="crm-empty">No quarterly data</div>';
	};

	// ── Pipeline ──────────────────────────────────────────────────────

	CRMDashboard.prototype.render_pipeline = function () {
		var self=this;
		document.getElementById('crm-pipeline').innerHTML=this.funnel.map(function(r){
			return '<div class="crm-stage" style="border-top-color:'+self.sc(r.stage)+'">' +
				'<div class="crm-stage-name" title="'+r.stage+'">'+r.stage+'</div>' +
				'<div class="crm-stage-count">'+r.count+'</div>' +
				'<div class="crm-stage-val">'+fmt(r.value)+'</div></div>';
		}).join('')||'<div class="crm-empty">No data</div>';
	};

	// ── Monthly Opps & Leads ─────────────────────────────────────────

	CRMDashboard.prototype.render_monthly_chart = function () {
		var ctx=document.getElementById('crm-monthly-chart');
		if(!ctx||!window.Chart||!this.monthly_trends.length) return;
		this.charts['monthly']=new Chart(ctx,{
			type:'line',
			data:{
				labels:this.monthly_trends.map(function(m){return m.label;}),
				datasets:[
					{label:'Opportunities',data:this.monthly_trends.map(function(m){return m.opps;}),
					 borderColor:C.blue,backgroundColor:'rgba(59,130,246,.08)',tension:.4,fill:true,pointRadius:3},
					{label:'Leads',data:this.monthly_trends.map(function(m){return m.leads;}),
					 borderColor:C.green,backgroundColor:'rgba(16,185,129,.08)',tension:.4,fill:true,pointRadius:3}
				]
			},
			options:{responsive:true,maintainAspectRatio:false,
				plugins:{legend:{position:'top',labels:{font:{size:11},boxWidth:12,usePointStyle:true}}},
				scales:{
					x:{ticks:{font:{size:9},maxRotation:35},grid:{display:false}},
					y:{ticks:{font:{size:10},stepSize:1,precision:0},grid:{color:'rgba(0,0,0,.05)'}}
				}}
		});
	};

	// ── Monthly Won & Lost ────────────────────────────────────────────

	CRMDashboard.prototype.render_revenue_chart = function () {
		var ctx=document.getElementById('crm-revenue-chart');
		if(!ctx||!window.Chart||!this.monthly_trends.length) return;
		this.charts['revenue']=new Chart(ctx,{
			type:'bar',
			data:{
				labels:this.monthly_trends.map(function(m){return m.label;}),
				datasets:[
					{label:'Won value (\u20B9)',type:'bar',
					 data:this.monthly_trends.map(function(m){return m.won_value;}),
					 backgroundColor:'rgba(16,185,129,.75)',borderRadius:4,yAxisID:'y'},
					{label:'Won deals',type:'line',
					 data:this.monthly_trends.map(function(m){return m.won_count;}),
					 borderColor:C.green,backgroundColor:'transparent',tension:.4,pointRadius:4,yAxisID:'y1'},
					{label:'Lost deals',type:'line',
					 data:this.monthly_trends.map(function(m){return m.lost_count;}),
					 borderColor:C.red,backgroundColor:'transparent',tension:.4,pointRadius:4,borderDash:[4,3],yAxisID:'y1'}
				]
			},
			options:{responsive:true,maintainAspectRatio:false,
				plugins:{legend:{position:'top',labels:{font:{size:11},boxWidth:12,usePointStyle:true}}},
				scales:{
					x:{ticks:{font:{size:9},maxRotation:35},grid:{display:false}},
					y:{position:'left',ticks:{font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}},
					y1:{position:'right',ticks:{font:{size:9},stepSize:1,precision:0},grid:{display:false}}
				}}
		});
	};

	// ── Lead Status donut ─────────────────────────────────────────────

	CRMDashboard.prototype.render_lead_chart = function () {
		var l=this.lead_status_leads||this.leads, statuses=this.lead_statuses;
		var colors=['#6B7280',C.blue,C.green,C.purple,C.pink,C.red,C.yellow,C.teal,C.indigo];
		var counts=statuses.map(function(s){return l.filter(function(x){return x.status===s;}).length;});
		var total=counts.reduce(function(a,b){return a+b;},0);
		var wrap=document.getElementById('crm-lead-status-wrap');
		var ctx=document.getElementById('crm-lead-chart');
		if(!ctx) return;
		if(total===0){
			if(wrap) wrap.innerHTML='<div class="crm-empty">No leads in selected period</div>';
			return;
		}
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

	// ── Revenue contribution donut ────────────────────────────────────

	CRMDashboard.prototype.render_revenue_donut = function () {
		var ctx=document.getElementById('crm-revenue-donut');
		if(!ctx||!window.Chart) return;
		var data=this.revenue_contribution.filter(function(r){return r.won_value>0;});
		if(!data.length){
			ctx.parentElement.innerHTML='<div class="crm-empty">No won deals yet</div>'; return;
		}
		var self=this;
		var total=data.reduce(function(s,r){return s+r.won_value;},0);
		this.charts['rev_donut']=new Chart(ctx,{
			type:'doughnut',
			data:{
				labels:data.map(function(r){return self.sp_name(r.owner);}),
				datasets:[{data:data.map(function(r){return r.won_value;}),
				           backgroundColor:data.map(function(_,i){return PALETTE[i%PALETTE.length];}),
				           borderWidth:2,hoverOffset:6}]
			},
			options:{responsive:true,maintainAspectRatio:false,
				plugins:{
					legend:{position:'right',labels:{font:{size:11},boxWidth:12,padding:10,usePointStyle:true}},
					tooltip:{callbacks:{label:function(ctx){
						var pct=total>0?Math.round((ctx.raw/total)*100):0;
						return ' '+self.sp_name(data[ctx.dataIndex].owner)+': '+fmt(ctx.raw)+' ('+pct+'%)';
					}}}
				}}
		});
	};

	// ── Source chart ──────────────────────────────────────────────────

	CRMDashboard.prototype.render_source_chart = function () {
		var ctx=document.getElementById('crm-source-chart');
		if(!ctx||!window.Chart) return;
		var sel=this._src_sel;
		var stats=(sel?this.source_stats.filter(function(s){return sel.indexOf(s.source)!==-1;}):this.source_stats)
			.slice().sort(function(a,b){return (b.opportunities+b.leads)-(a.opportunities+a.leads);});
		if(!stats.length){ctx.style.display='none';return;}
		ctx.style.display='';
		if(this.charts['source']){this.charts['source'].destroy();delete this.charts['source'];}
		this.charts['source']=new Chart(ctx,{
			type:'bar',
			data:{
				labels:stats.map(function(s){return s.source.length>16?s.source.slice(0,16)+'\u2026':s.source;}),
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
		var sel=this._terr_sel;
		var stats=(sel?this.territory_stats.filter(function(t){return sel.indexOf(t.territory)!==-1;}):this.territory_stats)
			.slice().sort(function(a,b){return (b.opportunities+b.leads)-(a.opportunities+a.leads);});
		if(!stats.length){ctx.style.display='none';return;}
		ctx.style.display='';
		if(this.charts['territory']){this.charts['territory'].destroy();delete this.charts['territory'];}
		this.charts['territory']=new Chart(ctx,{
			type:'bar',
			data:{
				labels:stats.map(function(t){var n=t.territory||'-';return n.length>14?n.slice(0,14)+'\u2026':n;}),
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

	// ── Heatmap helpers ───────────────────────────────────────────────

	CRMDashboard.prototype.set_metric = function (m, btn, type) {
		if(type==='opp') this.metric=m;
		else this.ms_metric=m;
		document.querySelectorAll('.crm-toggle').forEach(function(b){b.classList.remove('active');});
		btn.classList.add('active');
		if(type==='opp') this.render_opp_heatmap();
		else this.render_monthly_stage_heatmap();
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
		var f=this.salespersons.filter(function(sp){return sp.user===u;});
		return f.length?(f[0].full_name||user_label(u)):user_label(u);
	};

	CRMDashboard.prototype._hm_table = function (rows, cols, row_label_fn, cell_fn, leg_id) {
		var all_v=[];
		rows.forEach(function(r){cols.forEach(function(c){all_v.push(cell_fn(r,c,'v'));});});
		var max_v=Math.max.apply(null,all_v.concat([1]));

		var h='<table class="crm-hm-table"><thead><tr><th class="row-h">'+row_label_fn(null)+'</th>';
		cols.forEach(function(c){h+='<th title="'+c+'">'+(c.length>9?c.slice(0,9)+'\u2026':c)+'</th>';});
		h+='<th>Total</th></tr></thead><tbody>';

		var g_total=0;
		rows.forEach(function(r){
			h+='<tr><th class="row-h">'+row_label_fn(r)+'</th>';
			var r_total=0;
			cols.forEach(function(c){
				var v=cell_fn(r,c,'v'); r_total+=v;
				var t=v/max_v;
				var bg=hm_color(t); var tc=t>0.55?'#04342C':'inherit';
				h+='<td><div class="crm-hm-cell" style="background:'+bg+';color:'+tc+'">' +
					'<div class="cv">'+cell_fn(r,c,'l')+'</div>' +
					(cell_fn(r,c,'s')?'<div class="cs">'+cell_fn(r,c,'s')+'</div>':'')+
					'</div></td>';
			});
			g_total+=r_total;
			h+='<td class="crm-hm-total">'+r_total+'</td></tr>';
		});

		h+='<tr><td class="row-h crm-hm-footer">Total</td>';
		cols.forEach(function(c){
			var ct=rows.reduce(function(s,r){return s+cell_fn(r,c,'v');},0);
			h+='<td class="crm-hm-footer" style="text-align:center">'+ct+'</td>';
		});
		h+='<td class="crm-hm-total crm-hm-footer">'+g_total+'</td></tr>';
		h+='</tbody></table>';

		var strip='';
		for(var i=0;i<=16;i++) strip+='<div style="flex:1;background:'+hm_color(i/16)+'"></div>';
		var leg=document.getElementById(leg_id);
		if(leg) leg.innerHTML=strip;
		return h;
	};

	// ── Opp Heatmap: users vs stages ─────────────────────────────────

	CRMDashboard.prototype.render_opp_heatmap = function () {
		var el=document.getElementById('crm-opp-heatmap');
		if(!el) return;
		var self=this;
		var hm=this.opp_user_month_heatmap;
		if(!hm||!hm.rows||!hm.rows.length||!hm.months){el.innerHTML='<div class="crm-empty">No opportunity data</div>';return;}
		el.innerHTML=this._hm_table(hm.rows, hm.months,
			function(r){return r===null?'User':self.sp_name(r.owner);},
			function(r,month,mode){
				var c=r[month]||0;
				if(mode==='v') return c;
				if(mode==='l') return String(c);
				return '';
			},
			'crm-opp-hm-legend'
		);
	};

	// ── Lead Heatmap: users vs lead status ───────────────────────────

	CRMDashboard.prototype.render_lead_heatmap = function () {
		var el=document.getElementById('crm-lead-heatmap');
		if(!el) return;
		var self=this;
		var hm=this.lead_user_month_heatmap;
		if(!hm||!hm.rows||!hm.rows.length||!hm.months){el.innerHTML='<div class="crm-empty">No lead data</div>';return;}
		el.innerHTML=this._hm_table(hm.rows, hm.months,
			function(r){return r===null?'User':self.sp_name(r.owner);},
			function(r,month,mode){
				var c=r[month]||0;
				if(mode==='v') return c;
				if(mode==='l') return String(c);
				return '';
			},
			'crm-lead-hm-legend'
		);
	};

	// ── Monthly Stage Heatmap ─────────────────────────────────────────

	CRMDashboard.prototype.render_monthly_stage_heatmap = function () {
		var self=this, el=document.getElementById('crm-monthly-stage-heatmap');
		if(!el) return;
		var hm=this.monthly_stage_heatmap;
		if(!hm||!hm.months||!hm.stages||!hm.matrix){
			el.innerHTML='<div class="crm-empty">No data</div>'; return;
		}
		var metric=this.ms_metric||'count';
		var months=hm.months, stages=hm.stages, matrix=hm.matrix;

		// Populate user selector for managers
		if(this.is_mgr){
			var usel=document.getElementById('mshm-user-sel');
			if(usel&&usel.options.length<=1&&this.salespersons.length){
				var cur_v=usel.value;
				usel.innerHTML='<option value="">All</option>';
				this.salespersons.forEach(function(sp){
					var o=document.createElement('option');
					o.value=sp.user; o.textContent=sp.full_name||sp.user;
					usel.appendChild(o);
				});
				if(cur_v) usel.value=cur_v;
				usel.onchange=function(){self._mshm_user=this.value||null;self.render_monthly_stage_heatmap();};
			}
		}

		// Rebuild matrix if manager selected specific user
		var use_matrix=matrix;
		if(this.is_mgr&&this._mshm_user){
			use_matrix={};
			stages.forEach(function(s){use_matrix[s]={};months.forEach(function(m){use_matrix[s][m]={count:0,value:0};});});
			this.opps.filter(function(o){return o.opportunity_owner===self._mshm_user;}).forEach(function(o){
				var s=o.sales_stage; if(!s||!use_matrix[s]) return;
				try{
					var dt=new Date(o.transaction_date);
					var lbl=dt.toLocaleString('en-US',{month:'short'})+' '+dt.getFullYear();
					if(use_matrix[s][lbl]){use_matrix[s][lbl].count++;use_matrix[s][lbl].value+=parseFloat(o.opportunity_amount)||0;}
				}catch(e){}
			});
		}

		var rows=stages.map(function(s){return {stage:s};});
		el.innerHTML=this._hm_table(rows, months,
			function(r){return r===null?'Stage':r.stage;},
			function(r,month,mode){
				var cell=(use_matrix[r.stage]&&use_matrix[r.stage][month])||{count:0,value:0};
				if(mode==='v') return metric==='value'?cell.value:cell.count;
				if(mode==='l') return metric==='value'?fmt(cell.value):String(cell.count);
				return '';
			},
			'crm-mshm-legend'
		);
	};

	// ── Salesperson performance ───────────────────────────────────────

	CRMDashboard.prototype.render_sp_perf = function () {
		var self=this, container=document.getElementById('crm-sp-perf');
		if(!container) return;
		if(!this.is_mgr){
			var me=this.salesperson_stats.filter(function(s){return s.owner===self.me;})[0];
			if(!me){container.innerHTML='<div class="crm-empty">No data for selected period</div>';return;}
			var cl=(me.won||0)+(me.lost||0);
			var pct=cl>0?Math.round((me.won/cl)*100):0;
			container.innerHTML='<div style="text-align:center;padding:20px 0">' +
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
			var cl=(sp.won||0)+(sp.lost||0);
			var pct=cl>0?Math.round((sp.won/cl)*100):0;
			var bc=pct>=60?'#10B981':pct>=30?'#3B82F6':'#EF4444';
			var name=self.sp_name(sp.owner);
			var init=name.split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase();
			return '<div class="crm-sp-row">' +
				'<div class="crm-sp-info"><div class="crm-avatar">'+init+'</div>' +
				'<div><div style="font-size:13px;font-weight:600">'+name+'</div>' +
				'<div style="font-size:11px;color:var(--text-muted);margin-top:2px">'+(sp.won||0)+' won \u00B7 '+(sp.pipeline||0)+' pipeline</div>' +
				'<div class="crm-progress" style="width:140px"><div class="crm-progress-fill" style="width:'+pct+'%;background:'+bc+'"></div></div></div></div>' +
				'<div style="text-align:right">' +
				'<div style="font-size:13px;font-weight:700">'+fmt(sp.pipeline_value||0)+'</div>' +
				'<div style="font-size:11px;color:var(--text-muted)">'+pct+'% conv.</div></div></div>';
		}).join('');
	};

	// ── Multiselect helpers ───────────────────────────────────────────

	CRMDashboard.prototype._build_ms = function (key, items, sel) {
		var self=this;
		this['_ms_items_'+key]=items;
		var btn=document.getElementById(key+'-ms-btn');
		var dd =document.getElementById(key+'-ms-dd');
		var srch=document.getElementById(key+'-ms-search');
		var list=document.getElementById(key+'-ms-list');
		if(!btn||!dd||!list) return;

		btn.onclick=function(e){e.stopPropagation();dd.classList.toggle('open');if(dd.classList.contains('open')&&srch)srch.focus();};
		if(srch) srch.oninput=function(){
			var q=this.value.toLowerCase();
			Array.from(list.querySelectorAll('.crm-ms-item')).forEach(function(item){
				item.style.display=item.textContent.toLowerCase().includes(q)?'':'none';
			});
		};
		list.innerHTML=items.map(function(item){
			var checked=!sel||sel.indexOf(item)!==-1;
			return '<label class="crm-ms-item"><input type="checkbox" value="'+item+'" '+(checked?'checked':'')+'>'+
				'<span>'+item+'</span></label>';
		}).join('');
		this._ms_update_label(key, items, sel);
	};

	CRMDashboard.prototype._ms_update_label = function (key, items, sel) {
		var el=document.getElementById(key+'-ms-label');
		if(!el) return;
		var all_items=items||this['_ms_items_'+key]||[];
		if(!sel||sel.length===all_items.length) el.textContent='All '+(key==='src'?'sources':'territories');
		else if(!sel.length) el.textContent='None selected';
		else el.textContent=sel.length+' selected';
	};

	CRMDashboard.prototype._ms_all = function (key) {
		var l=document.getElementById(key+'-ms-list');
		if(l) l.querySelectorAll('input').forEach(function(cb){cb.checked=true;});
	};

	CRMDashboard.prototype._ms_none = function (key) {
		var l=document.getElementById(key+'-ms-list');
		if(l) l.querySelectorAll('input').forEach(function(cb){cb.checked=false;});
	};

	CRMDashboard.prototype._ms_apply = function (key) {
		var items=this['_ms_items_'+key]||[];
		var l=document.getElementById(key+'-ms-list');
		if(!l) return;
		var checked=Array.from(l.querySelectorAll('input:checked')).map(function(cb){return cb.value;});
		var sel=checked.length===items.length?null:checked;
		if(key==='src'){
			this._src_sel=sel;
			if(this.charts['source']){this.charts['source'].destroy();delete this.charts['source'];}
			this.render_source_chart();
		} else {
			this._terr_sel=sel;
			if(this.charts['territory']){this.charts['territory'].destroy();delete this.charts['territory'];}
			this.render_territory();
		}
		this._ms_update_label(key, items, checked);
		var dd=document.getElementById(key+'-ms-dd');
		if(dd) dd.classList.remove('open');
	};
