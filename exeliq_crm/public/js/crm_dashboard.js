// Exeliq CRM Dashboard v21
// Fix: page_form is detached — append to .page-head .container AFTER all fields added
// Use page.add_field() for proper Frappe integration, then move the container

(function () {

	function registerPage() {
		if (!frappe || !frappe.pages) { setTimeout(registerPage, 100); return; }
		if (!frappe.pages['crm-dashboard']) frappe.pages['crm-dashboard'] = {};
		frappe.pages['crm-dashboard'].on_page_load = function (wrapper) {
			if (window.Chart) { initDashboard(wrapper); return; }
			var s = document.createElement('script');
			s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
			s.onload = function () { initDashboard(wrapper); };
			s.onerror = function () { initDashboard(wrapper); };
			document.head.appendChild(s);
		};
	}

	function initDashboard(wrapper) {
		if (frappe.crm_dashboard) frappe.crm_dashboard.destroy_charts();
		var page = frappe.ui.make_app_page({
			parent: wrapper, title: 'CRM Pipeline Dashboard', single_column: true
		});
		frappe.crm_dashboard = new CRMDashboard(page);
	}

	// ── Helpers ───────────────────────────────────────────────────────

	function fmt(v) {
		v = parseFloat(v) || 0;
		if (v >= 10000000) return '₹' + (v / 10000000).toFixed(1) + ' Cr';
		if (v >= 100000)   return '₹' + (v / 100000).toFixed(1) + 'L';
		if (v >= 1000)     return '₹' + (v / 1000).toFixed(1) + 'K';
		return v > 0 ? '₹' + Math.round(v) : '₹0';
	}

	function user_label(u) {
		if (!u) return '-';
		var p = u.indexOf('@') !== -1 ? u.split('@')[0] : u;
		return p.replace(/[._]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
	}

	function initials(u) {
		return user_label(u).split(' ').map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
	}

	function hm_color(t) {
		return 'rgb(' +
			Math.round(225 + t * (8   - 225)) + ',' +
			Math.round(245 + t * (110 - 245)) + ',' +
			Math.round(238 + t * (72  - 238)) + ')';
	}

	var PALETTE = [
		'#378ADD','#1D9E75','#BA7517','#7F77DD','#D85A30',
		'#D4537E','#533AB7','#888780','#639922','#E24B4A',
		'#2A9D8F','#E9C46A','#F4A261','#264653','#A8DADC'
	];
	var LEAD_STATUSES = ['Open','Replied','Opportunity','Converted','Lost Quotation','Interested','Do Not Contact'];
	var LEAD_COLORS   = ['#378ADD','#1D9E75','#7F77DD','#639922','#E24B4A','#BA7517','#888780'];
	var WON_STAGE  = 'Closed Won';
	var LOST_STAGE = 'Closed Lost';

	// ── CRMDashboard ──────────────────────────────────────────────────

	function CRMDashboard(page) {
		this.page    = page;
		this.is_mgr  = frappe.user.has_role('Sales Manager') || frappe.user.has_role('System Manager');
		this.me      = frappe.session.user;
		this.metric  = 'count';
		this.charts  = {};
		this.loading = false;
		this.pending_reload = false;
		this.initializing = true;

		this.opps              = [];
		this.leads             = [];
		this.stages            = [];
		this.stage_color_map   = {};
		this.salespersons      = [];
		this.kpis              = {};
		this.funnel            = [];
		this.territory_stats   = [];
		this.salesperson_stats = [];

		this.setup_content();
		this.setup_filters();  // adds fields via page.add_field()
		this.mount_filters();  // moves page_form into visible DOM
		this.initializing = false;
		this.load_data();
	}

	// ── Content area ──────────────────────────────────────────────────

	CRMDashboard.prototype.setup_content = function () {
		var self = this;
		this.page.main.html(`
<style>
.crm-dash{padding:8px 4px 16px}
.crm-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px}
.crm-metric{background:var(--fg-color);border:1px solid var(--border-color);border-radius:8px;padding:14px 16px}
.crm-metric-label{font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}
.crm-metric-val{font-size:22px;font-weight:600;color:var(--text-color)}
.crm-metric-sub{font-size:11px;color:var(--text-muted);margin-top:3px}
.crm-metric-val.green{color:var(--green)}.crm-metric-val.red{color:var(--red)}
.crm-card{background:var(--fg-color);border:1px solid var(--border-color);border-radius:8px;padding:16px;margin-bottom:16px}
.crm-section-title{font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px}
.crm-two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:800px){.crm-two-col{grid-template-columns:1fr}}
.crm-pipeline{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
.crm-stage{flex:0 0 auto;min-width:110px;border:1px solid var(--border-color);border-radius:8px;padding:12px;border-top:3px solid #888}
.crm-stage-name{font-size:10px;color:var(--text-muted);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.crm-stage-count{font-size:22px;font-weight:600}.crm-stage-val{font-size:10px;color:var(--text-muted);margin-top:2px}
.crm-hm-wrap{overflow-x:auto}
.crm-hm-table{width:100%;border-collapse:separate;border-spacing:3px;min-width:700px;font-size:11px}
.crm-hm-table th{color:var(--text-muted);padding:4px 6px;text-align:center;font-weight:500;white-space:nowrap}
.crm-hm-table th.row-h{text-align:left;min-width:120px;font-size:12px;font-weight:500}
.crm-hm-cell{border-radius:4px;padding:8px 2px;text-align:center}
.crm-hm-cell .cv{font-size:13px;font-weight:600}.crm-hm-cell .cs{font-size:9px;margin-top:1px;opacity:.9}
.crm-hm-total{font-size:12px;font-weight:600;padding:4px 8px;text-align:center;color:var(--text-muted)}
.crm-hm-total span{font-size:10px;font-weight:400}
.crm-hm-footer{color:var(--text-muted)!important;font-weight:400!important;font-size:11px!important;padding:3px 6px!important}
.crm-toggle-row{display:flex;gap:6px;margin-bottom:12px}
.crm-toggle{font-size:12px;padding:4px 14px;border-radius:4px;border:1px solid var(--border-color);background:var(--fg-color);color:var(--text-muted);cursor:pointer}
.crm-toggle.active{background:var(--blue-tint,#e6f1fb);color:var(--blue);border-color:var(--blue)}
.crm-legend{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;color:var(--text-muted)}
.crm-legend-strip{display:flex;height:8px;width:120px;border-radius:3px;overflow:hidden}
.crm-sp-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.crm-sp-info{display:flex;align-items:center;gap:10px}
.crm-avatar{width:34px;height:34px;border-radius:50%;background:var(--blue-tint,#e6f1fb);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0}
.crm-progress{height:4px;background:var(--border-color);border-radius:2px;margin-top:5px}
.crm-progress-fill{height:100%;border-radius:2px;transition:width .3s}
.crm-empty{text-align:center;padding:32px;color:var(--text-muted);font-size:13px}
</style>
<div class="crm-dash">
  <div id="crm-metrics" class="crm-metrics">
    <div class="crm-metric"><div class="crm-metric-label">Loading…</div></div>
  </div>
  <div class="crm-card">
    <div class="crm-section-title">Pipeline by stage</div>
    <div id="crm-pipeline" class="crm-pipeline"></div>
  </div>
  <div class="crm-two-col">
    <div class="crm-card">
      <div class="crm-section-title">Stage breakdown (pipeline only)</div>
      <div style="position:relative;height:220px"><canvas id="crm-stage-chart"></canvas></div>
    </div>
    <div class="crm-card">
      <div class="crm-section-title">Lead status distribution</div>
      <div style="position:relative;height:220px"><canvas id="crm-lead-chart"></canvas></div>
    </div>
  </div>
  <div class="crm-two-col">
    <div class="crm-card">
      <div class="crm-section-title">Territory distribution (top 15)</div>
      <div style="position:relative;height:280px"><canvas id="crm-territory-chart"></canvas></div>
    </div>
    <div class="crm-card">
      <div class="crm-section-title">Sales funnel</div>
      <div id="crm-funnel" style="padding:4px 0;overflow-y:auto;max-height:280px"></div>
    </div>
  </div>
  <div class="crm-card">
    <div class="crm-section-title">Pipeline heatmap — users vs stages</div>
    <div class="crm-toggle-row">
      <button class="crm-toggle active" id="hm-count">Deal count</button>
      <button class="crm-toggle" id="hm-value">Deal value (₹)</button>
      <button class="crm-toggle" id="hm-both">Both</button>
    </div>
    <div class="crm-hm-wrap"><div id="crm-heatmap"></div></div>
    <div class="crm-legend">
      <span>Low</span>
      <div class="crm-legend-strip" id="crm-legend-strip"></div>
      <span>High</span>
    </div>
  </div>
  <div class="crm-card">
    <div class="crm-section-title">Salesperson performance</div>
    <div id="crm-sp-perf"></div>
  </div>
</div>`);

		document.getElementById('hm-count').onclick = function () { self.set_metric('count', this); };
		document.getElementById('hm-value').onclick = function () { self.set_metric('value', this); };
		document.getElementById('hm-both').onclick  = function () { self.set_metric('both',  this); };
	};

	// ── Setup filters via page.add_field() ───────────────────────────

	CRMDashboard.prototype.setup_filters = function () {
		var self = this;

		this.f_period = this.page.add_field({
			fieldtype: 'Select', fieldname: 'period', label: 'Range',
			options: ['Today','This Week','This Month','Last Month',
			          'This Quarter','Last Quarter','This Year','Custom'].join('\n'),
			default: 'This Month',
			change: function () {
				if (self.initializing) return;
				var p = self.f_period.get_value();
				if (p === 'Custom') return;
				var d = self.period_dates(p);
				self.f_from.set_value(d[0]);
				self.f_to.set_value(d[1]);
				self.load_data();
			}
		});

		var def = this.period_dates('This Month');

		this.f_from = this.page.add_field({
			fieldtype: 'Date', fieldname: 'from_date', label: 'From',
			default: def[0],
			change: function () {
				if (self.initializing) return;
				self.f_period.set_value('Custom');
				self.load_data();
			}
		});

		this.f_to = this.page.add_field({
			fieldtype: 'Date', fieldname: 'to_date', label: 'To',
			default: def[1],
			change: function () {
				if (self.initializing) return;
				self.f_period.set_value('Custom');
				self.load_data();
			}
		});

		if (this.is_mgr) {
			this.f_sp = this.page.add_field({
				fieldtype: 'Select', fieldname: 'salesperson', label: 'Salesperson',
				options: 'All',
				default: 'All',
				change: function () {
					if (self.initializing) return;
					self.load_data();
				}
			});
		}

		this.page.add_inner_button('Refresh', function () { self.load_data(); });
	};

	// ── Mount page_form into visible DOM ─────────────────────────────
	// page.add_field() appends to page_form but page_form is detached
	// in Frappe v15 with single_column:true — we fix by inserting it
	// into .page-head .container after all fields are added

	CRMDashboard.prototype.mount_filters = function () {
		var pf = this.page.page_form;
		if (!pf || !pf.length) return;

		var head_container = document.querySelector('.page-head .container');
		if (!head_container) {
			// Fallback: insert before the main content area
			var main = this.page.main && this.page.main[0];
			if (main && main.parentElement) {
				main.parentElement.insertBefore(pf[0], main);
			}
			return;
		}

		// Append after the existing page-head-content row
		head_container.appendChild(pf[0]);

		// Frappe sets display:none with !important on .page-form.row
		// Only a style tag with !important can override it
		var crm_style = document.getElementById('crm-pf-style');
		if (!crm_style) {
			crm_style = document.createElement('style');
			crm_style.id = 'crm-pf-style';
			document.head.appendChild(crm_style);
		}
		crm_style.textContent = '.page-form.row { display:flex !important; flex-wrap:wrap !important; gap:8px !important; padding:6px 0 8px 0 !important; align-items:flex-end !important; width:100% !important; border-top:1px solid var(--border-color) !important; margin-top:4px !important; }';
	};

	// ── Filter helpers ────────────────────────────────────────────────

	CRMDashboard.prototype.period_dates = function (p) {
		var now = frappe.datetime.now_date();
		if (p === 'Today')        return [now, now];
		if (p === 'This Week')    return [frappe.datetime.week_start(), now];
		if (p === 'This Month')   return [frappe.datetime.month_start(), now];
		if (p === 'This Quarter') return [frappe.datetime.quarter_start(), now];
		if (p === 'This Year')    return [frappe.datetime.year_start(), now];
		if (p === 'Last Month') {
			var d = frappe.datetime.str_to_obj(frappe.datetime.month_start());
			d.setDate(d.getDate() - 1);
			var end = frappe.datetime.obj_to_str(d);
			d.setDate(1);
			return [frappe.datetime.obj_to_str(d), end];
		}
		if (p === 'Last Quarter') {
			var qs = frappe.datetime.str_to_obj(frappe.datetime.quarter_start());
			qs.setDate(qs.getDate() - 1);
			var qe = frappe.datetime.obj_to_str(qs);
			var qsm = new Date(qs);
			qsm.setMonth(qsm.getMonth() - 2); qsm.setDate(1);
			return [frappe.datetime.obj_to_str(qsm), qe];
		}
		return [frappe.datetime.month_start(), now];
	};

	CRMDashboard.prototype.get_f = function () {
		return {
			from: (this.f_from && this.f_from.get_value()) || frappe.datetime.month_start(),
			to:   (this.f_to   && this.f_to.get_value())   || frappe.datetime.now_date(),
			sp:   (this.is_mgr && this.f_sp && this.f_sp.get_value() !== 'All') ? this.f_sp.get_value() : null
		};
	};

	// ── Data loading ──────────────────────────────────────────────────

	CRMDashboard.prototype.destroy_charts = function () {
		var self = this;
		Object.keys(self.charts).forEach(function (k) {
			try { if (self.charts[k]) self.charts[k].destroy(); } catch (e) {}
			delete self.charts[k];
		});
		self.charts = {};
	};

	CRMDashboard.prototype.load_data = function () {
		var self = this;
		if (this.loading) { this.pending_reload = true; return; }
		this.loading = true;

		var f = this.get_f();
		this.destroy_charts();
		document.getElementById('crm-metrics').innerHTML =
			'<div class="crm-metric"><div class="crm-metric-label">Loading…</div></div>';

		frappe.call({
			method: 'exeliq_crm.exeliq_crm.api.dashboard.get_dashboard_data',
			args: { from_date: f.from, to_date: f.to, salesperson: f.sp || null },
			callback: function (r) {
				self.loading = false;
				if (!r.message) {
					document.getElementById('crm-metrics').innerHTML =
						'<div style="color:var(--red);padding:10px">No data returned.</div>';
					return;
				}

				var d = r.message;
				self.opps              = d.opportunities       || [];
				self.leads             = d.leads               || [];
				self.kpis              = d.kpis                || {};
				self.territory_stats   = d.territory_stats     || [];
				self.salesperson_stats = d.salesperson_stats   || [];
				self.salespersons      = d.salespersons        || [];

				self.stages = (d.sales_stages || []).map(function (s) { return s.label || s.name; });
				self.stage_color_map = {};
				self.stages.forEach(function (s, i) {
					self.stage_color_map[s] = PALETTE[i % PALETTE.length];
				});

				var fd = d.funnel || {};
				self.funnel = self.stages.map(function (s) {
					var row = fd[s] || { count: 0, value: 0 };
					return { stage: s, count: row.count, value: row.value };
				});

				// Update salesperson dropdown
				if (self.f_sp && self.salespersons.length) {
					var current = self.f_sp.get_value();
					var opts = ['All'].concat(self.salespersons.map(function (sp) {
						return sp.full_name || user_label(sp.user);
					})).join('\n');
					self.f_sp.df.options = opts;
					self.f_sp.refresh();
					if (current && current !== 'All') self.f_sp.set_value(current);
				}

				self.render_all();

				if (self.pending_reload) {
					self.pending_reload = false;
					self.load_data();
				}
			},
			error: function (err) {
				self.loading = false;
				document.getElementById('crm-metrics').innerHTML =
					'<div style="color:var(--red);padding:10px">Error loading data.</div>';
				console.error('CRM Dashboard:', err);
			}
		});
	};

	// ── Render ────────────────────────────────────────────────────────

	CRMDashboard.prototype.render_all = function () {
		this.render_metrics();
		this.render_pipeline();
		this.render_stage_chart();
		this.render_lead_chart();
		this.render_territory();
		this.render_funnel();
		this.render_heatmap();
		this.render_sp_perf();
	};

	CRMDashboard.prototype.stage_color = function (s) {
		return this.stage_color_map[s] || '#888780';
	};

	CRMDashboard.prototype.render_metrics = function () {
		var k = this.kpis;
		var conv = parseFloat(k.conversion) || 0;
		var cards = [
			['Total Leads',    k.total_leads || 0,         'In selected period',           ''],
			['Opportunities',  k.total_opportunities || 0, (k.pipeline_count || 0) + ' in pipeline', ''],
			['Pipeline Value', fmt(k.pipeline_value || 0), 'Excl. Won & Lost',             ''],
			['Closed Won',     fmt(k.won_value || 0),      (k.won_count || 0) + ' deals',  'green'],
			['Closed Lost',    k.lost_count || 0,          fmt(k.lost_value || 0),         'red'],
			['Conv. Rate',     conv + '%',                 'Won / (Won + Lost)',            conv >= 30 ? 'green' : 'red']
		];
		document.getElementById('crm-metrics').innerHTML = cards.map(function (c) {
			return '<div class="crm-metric">' +
				'<div class="crm-metric-label">' + c[0] + '</div>' +
				'<div class="crm-metric-val ' + c[3] + '">' + c[1] + '</div>' +
				'<div class="crm-metric-sub">' + c[2] + '</div></div>';
		}).join('');
	};

	CRMDashboard.prototype.render_pipeline = function () {
		var self = this;
		document.getElementById('crm-pipeline').innerHTML = this.funnel.map(function (row) {
			return '<div class="crm-stage" style="border-top-color:' + self.stage_color(row.stage) + '">' +
				'<div class="crm-stage-name" title="' + row.stage + '">' + row.stage + '</div>' +
				'<div class="crm-stage-count">' + row.count + '</div>' +
				'<div class="crm-stage-val">' + fmt(row.value) + '</div></div>';
		}).join('') || '<div class="crm-empty">No data</div>';
	};

	CRMDashboard.prototype.render_stage_chart = function () {
		var self = this;
		var ctx = document.getElementById('crm-stage-chart');
		if (!ctx || !window.Chart) return;
		var pf = this.funnel.filter(function (r) { return r.stage !== WON_STAGE && r.stage !== LOST_STAGE; });
		if (!pf.length) return;
		this.charts['stage'] = new Chart(ctx, {
			type: 'bar',
			data: {
				labels: pf.map(function (r) { return r.stage.length > 12 ? r.stage.slice(0,12)+'…' : r.stage; }),
				datasets: [{ label:'Deals', data:pf.map(function(r){return r.count;}),
					backgroundColor:pf.map(function(r){return self.stage_color(r.stage);}), borderRadius:3 }]
			},
			options: {
				responsive:true, maintainAspectRatio:false,
				plugins:{ legend:{display:false} },
				scales:{
					x:{ticks:{font:{size:9},maxRotation:40,autoSkip:false},grid:{display:false}},
					y:{ticks:{font:{size:10},stepSize:1,precision:0},grid:{color:'rgba(128,128,128,0.1)'}}
				}
			}
		});
	};

	CRMDashboard.prototype.render_lead_chart = function () {
		var l = this.leads;
		var counts = LEAD_STATUSES.map(function(s){ return l.filter(function(x){return x.status===s;}).length; });
		var total = counts.reduce(function(a,b){return a+b;},0);
		var ctx = document.getElementById('crm-lead-chart');
		if (!ctx) return;
		if (total===0){ ctx.parentElement.innerHTML='<div class="crm-empty">No leads in selected period</div>'; return; }
		if (!window.Chart) return;
		this.charts['lead'] = new Chart(ctx, {
			type:'doughnut',
			data:{ labels:LEAD_STATUSES, datasets:[{ data:counts, backgroundColor:LEAD_COLORS, borderWidth:2 }] },
			options:{ responsive:true, maintainAspectRatio:false,
				plugins:{ legend:{ position:'right', labels:{ font:{size:11}, boxWidth:12, padding:8 } } } }
		});
	};

	CRMDashboard.prototype.render_territory = function () {
		var ctx = document.getElementById('crm-territory-chart');
		if (!ctx || !window.Chart) return;
		var stats = this.territory_stats.filter(function(t){ return t.opportunities>0||t.leads>0; });
		if (!stats.length) stats = this.territory_stats.slice(0,15);
		stats = stats.slice().sort(function(a,b){ return (b.opportunities+b.leads)-(a.opportunities+a.leads); }).slice(0,15);
		if (!stats.length){ ctx.parentElement.innerHTML='<div class="crm-empty">No territory data</div>'; return; }
		this.charts['territory'] = new Chart(ctx, {
			type:'bar',
			data:{
				labels:stats.map(function(t){ var n=t.territory||'-'; return n.length>14?n.slice(0,14)+'…':n; }),
				datasets:[
					{ label:'Opportunities', data:stats.map(function(t){return t.opportunities;}), backgroundColor:'#378ADD', borderRadius:3 },
					{ label:'Leads',         data:stats.map(function(t){return t.leads;}),         backgroundColor:'#1D9E75', borderRadius:3 }
				]
			},
			options:{ responsive:true, maintainAspectRatio:false,
				plugins:{ legend:{ position:'top', labels:{ font:{size:11}, boxWidth:12 } } },
				scales:{
					x:{ticks:{font:{size:10},maxRotation:35,autoSkip:false},grid:{display:false}},
					y:{ticks:{font:{size:10},stepSize:1,precision:0},grid:{color:'rgba(128,128,128,0.1)'}}
				}
			}
		});
	};

	CRMDashboard.prototype.render_funnel = function () {
		var container = document.getElementById('crm-funnel');
		if (!container) return;
		var pf = this.funnel.filter(function(r){ return r.stage !== LOST_STAGE; });
		if (!pf.length){ container.innerHTML='<div class="crm-empty">No opportunities found</div>'; return; }
		var max = pf[0] ? pf[0].count : 1;
		container.innerHTML = pf.map(function(row,i){
			var pct = max>0 ? Math.round((row.count/max)*100) : 0;
			var color = PALETTE[i%PALETTE.length];
			return '<div style="margin-bottom:14px">' +
				'<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">' +
				'<span style="font-weight:500">'+row.stage+'</span>' +
				'<span style="color:var(--text-muted)">'+row.count+' · '+fmt(row.value)+'</span>' +
				'</div>' +
				'<div style="height:16px;background:var(--border-color);border-radius:4px;overflow:hidden">' +
				'<div style="width:'+pct+'%;height:100%;background:'+color+';border-radius:4px;transition:width .4s"></div>' +
				'</div></div>';
		}).join('');
	};

	CRMDashboard.prototype.set_metric = function (m, btn) {
		this.metric = m;
		document.querySelectorAll('.crm-toggle').forEach(function(b){ b.classList.remove('active'); });
		btn.classList.add('active');
		this.render_heatmap();
	};

	CRMDashboard.prototype.hm_users = function () {
		if (!this.is_mgr) return [this.me];
		var seen={}, result=[];
		this.salespersons.forEach(function(sp){ if(sp.user&&!seen[sp.user]){seen[sp.user]=1;result.push(sp.user);} });
		this.opps.forEach(function(o){ if(o.opportunity_owner&&!seen[o.opportunity_owner]){seen[o.opportunity_owner]=1;result.push(o.opportunity_owner);} });
		return result;
	};

	CRMDashboard.prototype.sp_name = function (u) {
		if (!u) return '-';
		var found = this.salespersons.filter(function(sp){ return sp.user===u; });
		return found.length ? (found[0].full_name||user_label(u)) : user_label(u);
	};

	CRMDashboard.prototype.render_heatmap = function () {
		var self=this, users=this.hm_users(), metric=this.metric;
		if (!users.length||!self.stages.length){
			document.getElementById('crm-heatmap').innerHTML='<div class="crm-empty">No data</div>'; return;
		}
		var all_c=[],all_v=[];
		users.forEach(function(u){ self.stages.forEach(function(s){
			var items=self.opps.filter(function(o){return o.opportunity_owner===u&&o.sales_stage===s;});
			all_c.push(items.length);
			all_v.push(items.reduce(function(sum,o){return sum+(parseFloat(o.opportunity_amount)||0);},0));
		}); });
		var max_c=Math.max.apply(null,all_c.concat([1]));
		var max_v=Math.max.apply(null,all_v.concat([1]));

		var html='<table class="crm-hm-table"><thead><tr><th class="row-h">User</th>';
		self.stages.forEach(function(s){ html+='<th title="'+s+'">'+(s.length>9?s.slice(0,9)+'…':s)+'</th>'; });
		html+='<th>Total</th></tr></thead><tbody>';

		var g_c=0,g_v=0;
		users.forEach(function(u){
			var u_c=0,u_v=0;
			html+='<tr><th class="row-h">'+self.sp_name(u)+'</th>';
			self.stages.forEach(function(s){
				var items=self.opps.filter(function(o){return o.opportunity_owner===u&&o.sales_stage===s;});
				var c=items.length;
				var v=items.reduce(function(sum,o){return sum+(parseFloat(o.opportunity_amount)||0);},0);
				u_c+=c; u_v+=v;
				var t=metric==='value'?v/max_v:c/max_c;
				var bg=hm_color(t); var tc=t>0.55?'#04342C':'inherit';
				html+='<td><div class="crm-hm-cell" style="background:'+bg+';color:'+tc+'">' +
					'<div class="cv">'+(metric==='value'?fmt(v):c)+'</div>' +
					(metric==='both'&&c>0?'<div class="cs">'+fmt(v)+'</div>':'')+
					'</div></td>';
			});
			g_c+=u_c; g_v+=u_v;
			html+='<td class="crm-hm-total">'+u_c+'<br><span>'+fmt(u_v)+'</span></td></tr>';
		});

		html+='<tr><td class="row-h crm-hm-footer">Stage total</td>';
		self.stages.forEach(function(s){
			var sr=self.funnel.filter(function(r){return r.stage===s;});
			var sc=sr.length?sr[0].count:0; var sv=sr.length?sr[0].value:0;
			html+='<td class="crm-hm-footer" style="text-align:center">'+sc+'<br><span style="font-size:10px">'+fmt(sv)+'</span></td>';
		});
		html+='<td class="crm-hm-total crm-hm-footer">'+g_c+'<br><span>'+fmt(g_v)+'</span></td></tr>';
		html+='</tbody></table>';
		document.getElementById('crm-heatmap').innerHTML=html;

		var strip='';
		for(var i=0;i<=16;i++) strip+='<div style="flex:1;background:'+hm_color(i/16)+'"></div>';
		document.getElementById('crm-legend-strip').innerHTML=strip;
	};

	CRMDashboard.prototype.render_sp_perf = function () {
		var self=this;
		var container=document.getElementById('crm-sp-perf');
		if (!container) return;

		if (!this.is_mgr) {
			var me=this.salesperson_stats.filter(function(s){return s.owner===self.me;})[0];
			if (!me){ container.innerHTML='<div class="crm-empty">No data for selected period</div>'; return; }
			var closed=(me.won||0)+(me.lost||0);
			var pct=closed>0?Math.round((me.won/closed)*100):0;
			container.innerHTML=
				'<div style="text-align:center;padding:24px 0">' +
				'<div style="font-size:32px;font-weight:600">'+(me.opportunities||0)+'</div>' +
				'<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">My opportunities</div>' +
				'<div style="display:flex;gap:24px;justify-content:center;font-size:13px">' +
				'<span><b style="color:var(--green)">'+(me.won||0)+'</b> Won</span>' +
				'<span><b>'+(me.pipeline||0)+'</b> Pipeline</span>' +
				'<span><b>'+fmt(me.pipeline_value||0)+'</b> Pipeline value</span></div>' +
				'<div style="margin-top:10px;font-size:13px;color:var(--text-muted)">'+pct+'% conv. rate</div></div>';
			return;
		}

		if (!this.salesperson_stats.length){
			container.innerHTML='<div class="crm-empty">No data for selected period</div>'; return;
		}

		container.innerHTML=this.salesperson_stats.map(function(sp){
			var closed=(sp.won||0)+(sp.lost||0);
			var pct=closed>0?Math.round((sp.won/closed)*100):0;
			var bc=pct>=60?'var(--green)':pct>=30?'var(--blue)':'var(--red)';
			var name=self.sp_name(sp.owner);
			var init=name.split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase();
			return '<div class="crm-sp-row">' +
				'<div class="crm-sp-info">' +
				'<div class="crm-avatar">'+init+'</div>' +
				'<div><div style="font-size:13px;font-weight:500">'+name+'</div>' +
				'<div style="font-size:11px;color:var(--text-muted)">'+(sp.won||0)+' won · '+(sp.pipeline||0)+' pipeline</div>' +
				'<div class="crm-progress" style="width:140px"><div class="crm-progress-fill" style="width:'+pct+'%;background:'+bc+'"></div></div></div></div>' +
				'<div style="text-align:right">' +
				'<div style="font-size:13px;font-weight:600">'+fmt(sp.pipeline_value||0)+'</div>' +
				'<div style="font-size:11px;color:var(--text-muted)">'+pct+'% conv. rate</div></div></div>';
		}).join('');
	};

	registerPage();
})();
