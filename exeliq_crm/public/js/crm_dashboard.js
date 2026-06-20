// Exeliq CRM Dashboard v24
// Fixes: salesperson loop, territory/source multi-select, bigger pipeline cards,
// modern color palette, all zero values shown

(function () {

	// ── Page registration ─────────────────────────────────────────────
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

	// Modern color palette
	var PALETTE = [
		'#6366F1','#10B981','#F59E0B','#EF4444','#3B82F6',
		'#8B5CF6','#EC4899','#14B8A6','#F97316','#84CC16',
		'#06B6D4','#A855F7','#D946EF','#0EA5E9','#22C55E'
	];

	var CHART_COLORS = {
		blue:   '#3B82F6',
		green:  '#10B981',
		purple: '#8B5CF6',
		orange: '#F97316',
		red:    '#EF4444',
		teal:   '#14B8A6',
		indigo: '#6366F1',
		pink:   '#EC4899',
		yellow: '#F59E0B',
		cyan:   '#06B6D4'
	};

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
		this.initializing  = true;
		this._updating_sp  = false; // guard flag for salesperson loop

		// Data
		this.opps              = [];
		this.leads             = [];
		this.stages            = [];
		this.lead_statuses     = [];
		this.stage_color_map   = {};
		this.salespersons      = [];
		this.kpis              = {};
		this.funnel            = [];
		this.territory_stats   = [];
		this.salesperson_stats = [];
		this.monthly_trends    = [];
		this.source_stats      = [];
		this.fiscal_years      = {};

		// Selected filters for charts
		this._terr_selection   = null; // null = all
		this._src_selection    = null; // null = all

		this.setup_content();
		this.setup_filters();
		this.mount_filters();
		this.initializing = false;
		this.load_data();
	}

	// ── Content HTML ──────────────────────────────────────────────────

	CRMDashboard.prototype.setup_content = function () {
		var self = this;
		this.page.main.html(`
<style>
/* ── Reset & base ── */
.crm-dash { padding: 8px 4px 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

/* ── Metric cards ── */
.crm-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
.crm-metric { background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 10px; padding: 16px 18px; position: relative; overflow: hidden; }
.crm-metric::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--metric-accent, #6366F1); }
.crm-metric-label { font-size: 10px; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
.crm-metric-val { font-size: 26px; font-weight: 700; color: var(--text-color); line-height: 1.1; }
.crm-metric-sub { font-size: 11px; color: var(--text-muted); margin-top: 5px; }
.crm-metric-val.green { color: #10B981; }
.crm-metric-val.red   { color: #EF4444; }

/* ── Cards ── */
.crm-card { background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 10px; padding: 18px; margin-bottom: 18px; }
.crm-section-title { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .07em; margin-bottom: 14px; }

/* ── Two column layout ── */
.crm-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 18px; }
@media(max-width: 800px) { .crm-two-col { grid-template-columns: 1fr; } }

/* ── Pipeline strip ── */
.crm-pipeline { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
.crm-pipeline::-webkit-scrollbar { height: 4px; }
.crm-pipeline::-webkit-scrollbar-track { background: var(--border-color); border-radius: 2px; }
.crm-pipeline::-webkit-scrollbar-thumb { background: #6366F1; border-radius: 2px; }
.crm-stage { flex: 0 0 auto; min-width: 150px; background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 10px; padding: 18px 20px; border-top: 4px solid #888; transition: box-shadow .2s; cursor: default; }
.crm-stage:hover { box-shadow: 0 4px 12px rgba(0,0,0,.08); }
.crm-stage-name { font-size: 11px; color: var(--text-muted); margin-bottom: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.crm-stage-count { font-size: 36px; font-weight: 800; color: var(--text-color); line-height: 1; }
.crm-stage-val { font-size: 13px; color: var(--text-muted); margin-top: 6px; font-weight: 500; }

/* ── Chart filter bar ── */
.crm-chart-filter { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.crm-chart-filter label { font-size: 10px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
.crm-multiselect-wrap { position: relative; flex: 1; min-width: 200px; }
.crm-multiselect-btn { width: 100%; padding: 5px 10px; font-size: 12px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--fg-color); color: var(--text-color); cursor: pointer; text-align: left; display: flex; justify-content: space-between; align-items: center; }
.crm-multiselect-btn:hover { border-color: #6366F1; }
.crm-multiselect-dropdown { display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.12); z-index: 1000; max-height: 260px; overflow: hidden; margin-top: 3px; }
.crm-multiselect-dropdown.open { display: flex; flex-direction: column; }
.crm-ms-search { padding: 8px; border-bottom: 1px solid var(--border-color); }
.crm-ms-search input { width: 100%; padding: 5px 8px; font-size: 12px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--fg-color); color: var(--text-color); outline: none; }
.crm-ms-list { overflow-y: auto; max-height: 190px; }
.crm-ms-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; color: var(--text-color); }
.crm-ms-item:hover { background: var(--blue-tint, #EEF2FF); }
.crm-ms-item input[type=checkbox] { margin: 0; cursor: pointer; accent-color: #6366F1; }
.crm-ms-footer { padding: 6px 10px; border-top: 1px solid var(--border-color); display: flex; gap: 6px; }
.crm-ms-footer button { font-size: 11px; padding: 3px 10px; border-radius: 4px; border: 1px solid var(--border-color); cursor: pointer; background: var(--fg-color); color: var(--text-color); }
.crm-ms-footer button.primary { background: #6366F1; color: #fff; border-color: #6366F1; }

/* ── Heatmap ── */
.crm-hm-wrap { overflow-x: auto; }
.crm-hm-table { width: 100%; border-collapse: separate; border-spacing: 3px; min-width: 700px; font-size: 11px; }
.crm-hm-table th { color: var(--text-muted); padding: 4px 6px; text-align: center; font-weight: 500; white-space: nowrap; }
.crm-hm-table th.row-h { text-align: left; min-width: 120px; font-size: 12px; font-weight: 600; }
.crm-hm-cell { border-radius: 5px; padding: 8px 2px; text-align: center; }
.crm-hm-cell .cv { font-size: 13px; font-weight: 700; }
.crm-hm-cell .cs { font-size: 9px; margin-top: 1px; opacity: .9; }
.crm-hm-total { font-size: 12px; font-weight: 700; padding: 4px 8px; text-align: center; color: var(--text-muted); }
.crm-hm-total span { font-size: 10px; font-weight: 400; }
.crm-hm-footer { color: var(--text-muted) !important; font-weight: 400 !important; font-size: 11px !important; padding: 3px 6px !important; }
.crm-toggle-row { display: flex; gap: 6px; margin-bottom: 12px; }
.crm-toggle { font-size: 12px; padding: 5px 14px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--fg-color); color: var(--text-muted); cursor: pointer; font-weight: 500; }
.crm-toggle.active { background: #EEF2FF; color: #6366F1; border-color: #6366F1; }
.crm-legend { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 11px; color: var(--text-muted); }
.crm-legend-strip { display: flex; height: 8px; width: 120px; border-radius: 4px; overflow: hidden; }

/* ── Salesperson ── */
.crm-sp-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border-color); }
.crm-sp-row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
.crm-sp-info { display: flex; align-items: center; gap: 10px; }
.crm-avatar { width: 36px; height: 36px; border-radius: 50%; background: #EEF2FF; color: #6366F1; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
.crm-progress { height: 4px; background: var(--border-color); border-radius: 2px; margin-top: 6px; }
.crm-progress-fill { height: 100%; border-radius: 2px; transition: width .4s; }
.crm-empty { text-align: center; padding: 36px; color: var(--text-muted); font-size: 13px; }
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
      <div class="crm-section-title">Monthly opportunities &amp; leads created</div>
      <div style="position:relative;height:220px"><canvas id="crm-monthly-chart"></canvas></div>
    </div>
    <div class="crm-card">
      <div class="crm-section-title">Monthly won deals &amp; revenue</div>
      <div style="position:relative;height:220px"><canvas id="crm-revenue-chart"></canvas></div>
    </div>
  </div>
  <div class="crm-two-col">
    <div class="crm-card">
      <div class="crm-section-title">Lead status distribution</div>
      <div style="position:relative;height:240px"><canvas id="crm-lead-chart"></canvas></div>
    </div>
    <div class="crm-card">
      <div class="crm-section-title">Source distribution</div>
      <div class="crm-chart-filter">
        <label>Filter</label>
        <div class="crm-multiselect-wrap" id="src-ms-wrap">
          <button class="crm-multiselect-btn" id="src-ms-btn">
            <span id="src-ms-label">All sources</span><span>▾</span>
          </button>
          <div class="crm-multiselect-dropdown" id="src-ms-dropdown">
            <div class="crm-ms-search"><input type="text" id="src-ms-search" placeholder="Search sources…"></div>
            <div class="crm-ms-list" id="src-ms-list"></div>
            <div class="crm-ms-footer">
              <button onclick="frappe.crm_dashboard._ms_select_all('src')">All</button>
              <button onclick="frappe.crm_dashboard._ms_clear_all('src')">None</button>
              <button class="primary" onclick="frappe.crm_dashboard._ms_apply('src')">Apply</button>
            </div>
          </div>
        </div>
      </div>
      <div style="position:relative;height:200px"><canvas id="crm-source-chart"></canvas></div>
    </div>
  </div>
  <div class="crm-two-col">
    <div class="crm-card">
      <div class="crm-section-title">Territory distribution</div>
      <div class="crm-chart-filter">
        <label>Filter</label>
        <div class="crm-multiselect-wrap" id="terr-ms-wrap">
          <button class="crm-multiselect-btn" id="terr-ms-btn">
            <span id="terr-ms-label">All territories</span><span>▾</span>
          </button>
          <div class="crm-multiselect-dropdown" id="terr-ms-dropdown">
            <div class="crm-ms-search"><input type="text" id="terr-ms-search" placeholder="Search territories…"></div>
            <div class="crm-ms-list" id="terr-ms-list"></div>
            <div class="crm-ms-footer">
              <button onclick="frappe.crm_dashboard._ms_select_all('terr')">All</button>
              <button onclick="frappe.crm_dashboard._ms_clear_all('terr')">None</button>
              <button class="primary" onclick="frappe.crm_dashboard._ms_apply('terr')">Apply</button>
            </div>
          </div>
        </div>
      </div>
      <div style="position:relative;height:200px"><canvas id="crm-territory-chart"></canvas></div>
    </div>
    <div class="crm-card">
      <div class="crm-section-title">Salesperson performance</div>
      <div id="crm-sp-perf" style="overflow-y:auto;max-height:290px"></div>
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
</div>`);

		document.getElementById('hm-count').onclick = function () { self.set_metric('count', this); };
		document.getElementById('hm-value').onclick = function () { self.set_metric('value', this); };
		document.getElementById('hm-both').onclick  = function () { self.set_metric('both',  this); };

		// Close dropdowns on outside click
		document.addEventListener('click', function (e) {
			['src', 'terr'].forEach(function (k) {
				var wrap = document.getElementById(k + '-ms-wrap');
				var dd   = document.getElementById(k + '-ms-dropdown');
				if (wrap && dd && !wrap.contains(e.target)) dd.classList.remove('open');
			});
		});
	};

	// ── Multi-select helpers ──────────────────────────────────────────

	CRMDashboard.prototype._build_multiselect = function (key, items, current_selection) {
		var self = this;
		var list_el   = document.getElementById(key + '-ms-list');
		var search_el = document.getElementById(key + '-ms-search');
		var btn_el    = document.getElementById(key + '-ms-btn');
		var label_el  = document.getElementById(key + '-ms-label');
		var dd_el     = document.getElementById(key + '-ms-dropdown');
		if (!list_el) return;

		// Toggle dropdown
		btn_el.onclick = function (e) {
			e.stopPropagation();
			dd_el.classList.toggle('open');
			if (dd_el.classList.contains('open')) search_el.focus();
		};

		// Search filter
		search_el.oninput = function () {
			var q = this.value.toLowerCase();
			Array.from(list_el.querySelectorAll('.crm-ms-item')).forEach(function (item) {
				item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
			});
		};

		// Render checkboxes
		this['_ms_items_' + key] = items;
		this._render_ms_list(key, current_selection);

		// Update label
		this._update_ms_label(key, label_el, items, current_selection);
	};

	CRMDashboard.prototype._render_ms_list = function (key, selection) {
		var items   = this['_ms_items_' + key] || [];
		var list_el = document.getElementById(key + '-ms-list');
		if (!list_el) return;
		list_el.innerHTML = items.map(function (item) {
			var checked = !selection || selection.indexOf(item) !== -1;
			return '<label class="crm-ms-item">' +
				'<input type="checkbox" value="' + item + '" ' + (checked ? 'checked' : '') + '>' +
				'<span>' + item + '</span></label>';
		}).join('');
	};

	CRMDashboard.prototype._update_ms_label = function (key, label_el, items, selection) {
		if (!label_el) label_el = document.getElementById(key + '-ms-label');
		if (!label_el) return;
		if (!selection || selection.length === items.length) {
			label_el.textContent = 'All ' + (key === 'src' ? 'sources' : 'territories');
		} else if (selection.length === 0) {
			label_el.textContent = 'None selected';
		} else {
			label_el.textContent = selection.length + ' selected';
		}
	};

	CRMDashboard.prototype._get_ms_checked = function (key) {
		var list_el = document.getElementById(key + '-ms-list');
		if (!list_el) return null;
		var checked = Array.from(list_el.querySelectorAll('input[type=checkbox]:checked'))
			.map(function (cb) { return cb.value; });
		return checked;
	};

	CRMDashboard.prototype._ms_select_all = function (key) {
		var list_el = document.getElementById(key + '-ms-list');
		if (!list_el) return;
		list_el.querySelectorAll('input[type=checkbox]').forEach(function (cb) { cb.checked = true; });
	};

	CRMDashboard.prototype._ms_clear_all = function (key) {
		var list_el = document.getElementById(key + '-ms-list');
		if (!list_el) return;
		list_el.querySelectorAll('input[type=checkbox]').forEach(function (cb) { cb.checked = false; });
	};

	CRMDashboard.prototype._ms_apply = function (key) {
		var items  = this['_ms_items_' + key] || [];
		var checked = this._get_ms_checked(key);
		var all     = checked.length === items.length;
		var selection = all ? null : checked;

		if (key === 'src') {
			this._src_selection = selection;
			this._update_ms_label('src', null, items, checked);
			if (this.charts['source']) { this.charts['source'].destroy(); delete this.charts['source']; }
			this.render_source_chart();
		} else {
			this._terr_selection = selection;
			this._update_ms_label('terr', null, items, checked);
			if (this.charts['territory']) { this.charts['territory'].destroy(); delete this.charts['territory']; }
			this.render_territory();
		}
		document.getElementById(key + '-ms-dropdown').classList.remove('open');
	};

	// ── Filters ───────────────────────────────────────────────────────

	CRMDashboard.prototype.setup_filters = function () {
		var self = this;

		this.f_period = this.page.add_field({
			fieldtype: 'Select', fieldname: 'period', label: 'Range',
			options: ['Today','This Week','This Month','Last Month',
			          'This Quarter','Last Quarter','This FY','Last FY',
			          'This Year','Custom'].join('\n'),
			default: 'This Month',
			change: function () {
				if (self.initializing || self._updating_sp) return;
				var p = self.f_period.get_value();
				if (p === 'Custom') return;
				var d = self.period_dates(p);
				if (d) {
					self.f_from.set_value(d[0]);
					self.f_to.set_value(d[1]);
				}
				self.load_data();
			}
		});

		var def = this.period_dates('This Month');
		this.f_from = this.page.add_field({
			fieldtype: 'Date', fieldname: 'from_date', label: 'From',
			default: def[0],
			change: function () {
				if (self.initializing || self._updating_sp) return;
				self.f_period.set_value('Custom');
				self.load_data();
			}
		});

		this.f_to = this.page.add_field({
			fieldtype: 'Date', fieldname: 'to_date', label: 'To',
			default: def[1],
			change: function () {
				if (self.initializing || self._updating_sp) return;
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
					if (self.initializing || self._updating_sp) return;
					self.load_data();
				}
			});
		}

		this.page.add_inner_button('Refresh', function () { self.load_data(); });
	};

	CRMDashboard.prototype.mount_filters = function () {
		var pf = this.page.page_form;
		if (!pf || !pf.length) return;
		var hc = document.querySelector('.page-head .container');
		if (hc) hc.appendChild(pf[0]);
		var st = document.getElementById('crm-pf-style') || document.createElement('style');
		st.id = 'crm-pf-style';
		st.textContent = '.page-form.row{display:flex!important;flex-wrap:wrap!important;gap:8px!important;padding:6px 0 8px 0!important;align-items:flex-end!important;width:100%!important;border-top:1px solid var(--border-color)!important;margin-top:4px!important}';
		document.head.appendChild(st);
	};

	CRMDashboard.prototype.period_dates = function (p) {
		var now = frappe.datetime.now_date();
		if (p === 'Today')        return [now, now];
		if (p === 'This Week')    return [frappe.datetime.week_start(), now];
		if (p === 'This Month')   return [frappe.datetime.month_start(), now];
		if (p === 'This Quarter') return [frappe.datetime.quarter_start(), now];
		if (p === 'This Year')    return [frappe.datetime.year_start(), now];
		if (p === 'This FY') {
			var fy = this.fiscal_years && this.fiscal_years.current;
			return fy ? [fy.from, fy.to] : [frappe.datetime.year_start(), now];
		}
		if (p === 'Last FY') {
			var lfy = this.fiscal_years && this.fiscal_years.last;
			return lfy ? [lfy.from, lfy.to] : null;
		}
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
						'<div style="color:#EF4444;padding:10px">No data returned.</div>';
					return;
				}

				var d = r.message;
				self.opps              = d.opportunities       || [];
				self.leads             = d.leads               || [];
				self.kpis              = d.kpis                || {};
				self.territory_stats   = d.territory_stats     || [];
				self.salesperson_stats = d.salesperson_stats   || [];
				self.salespersons      = d.salespersons        || [];
				self.monthly_trends    = d.monthly_trends      || [];
				self.source_stats      = d.source_stats        || [];
				self.fiscal_years      = d.fiscal_years        || {};
				self.lead_statuses     = d.lead_statuses       || [
					'Lead','Open','Replied','Opportunity','Quotation',
					'Lost Quotation','Interested','Converted','Do Not Contact'
				];

				// Stages
				self.stages = (d.sales_stages || []).map(function (s) { return s.label || s.name; });
				self.stage_color_map = {};
				self.stages.forEach(function (s, i) {
					self.stage_color_map[s] = PALETTE[i % PALETTE.length];
				});

				// Funnel
				var fd = d.funnel || {};
				self.funnel = self.stages.map(function (s) {
					var row = fd[s] || { count: 0, value: 0 };
					return { stage: s, count: row.count, value: row.value };
				});

				// Update salesperson dropdown — use email as value, show full name as label
				// Guard flag prevents the set_value from triggering another load_data
				if (self.f_sp && self.salespersons.length) {
					self._updating_sp = true;
					var current_sp = self.f_sp.get_value();
					var opts_sp = ['All'].concat(
						self.salespersons.map(function (sp) { return sp.user; })
					).join('\n');
					self.f_sp.df.options = opts_sp;
					self.f_sp.refresh();

					// Relabel option text to full names
					var sel_el = self.f_sp.$wrapper && self.f_sp.$wrapper[0] &&
						self.f_sp.$wrapper[0].querySelector('select');
					if (sel_el) {
						Array.from(sel_el.options).forEach(function (opt) {
							if (!opt.value || opt.value === 'All') return;
							var sp = self.salespersons.filter(function (s) { return s.user === opt.value; })[0];
							if (sp && sp.full_name) opt.text = sp.full_name;
						});
					}
					if (current_sp && current_sp !== 'All') self.f_sp.set_value(current_sp);
					// Release guard after all Frappe promises resolve
					setTimeout(function () { self._updating_sp = false; }, 200);
				}

				// Build multi-select filter options
				var all_territories = self.territory_stats.map(function (t) { return t.territory; }).filter(Boolean).sort();
				var all_sources     = self.source_stats.map(function (s) { return s.source; }).filter(Boolean).sort();

				self._ms_items_terr = all_territories;
				self._ms_items_src  = all_sources;

				self._build_multiselect('terr', all_territories, self._terr_selection);
				self._build_multiselect('src',  all_sources,     self._src_selection);

				self.render_all();

				if (self.pending_reload) {
					self.pending_reload = false;
					self.load_data();
				}
			},
			error: function (err) {
				self.loading = false;
				document.getElementById('crm-metrics').innerHTML =
					'<div style="color:#EF4444;padding:10px">Error loading data.</div>';
				console.error('CRM Dashboard:', err);
			}
		});
	};

	// ── Render ────────────────────────────────────────────────────────

	CRMDashboard.prototype.render_all = function () {
		this.render_metrics();
		this.render_pipeline();
		this.render_monthly_chart();
		this.render_revenue_chart();
		this.render_lead_chart();
		this.render_source_chart();
		this.render_territory();
		this.render_sp_perf();
		this.render_heatmap();
	};

	CRMDashboard.prototype.stage_color = function (s) {
		return this.stage_color_map[s] || '#6366F1';
	};

	// ── Metrics ───────────────────────────────────────────────────────

	CRMDashboard.prototype.render_metrics = function () {
		var k = this.kpis;
		var conv = parseFloat(k.conversion) || 0;
		var accents = ['#6366F1','#3B82F6','#8B5CF6','#10B981','#EF4444','#F59E0B','#14B8A6'];
		var cards = [
			['Total Leads',    k.total_leads || 0,         'In selected period',           '',      accents[0]],
			['Opportunities',  k.total_opportunities || 0, (k.pipeline_count||0)+' pipeline','',    accents[1]],
			['Pipeline Value', fmt(k.pipeline_value||0),   'Excl. Won & Lost',             '',      accents[2]],
			['Closed Won',     fmt(k.won_value||0),        (k.won_count||0)+' deals',      'green', accents[3]],
			['Closed Lost',    k.lost_count||0,            fmt(k.lost_value||0),           'red',   accents[4]],
			['Conv. Rate',     conv+'%',                   'Won / (Won+Lost)',              conv>=30?'green':'red', accents[5]],
			['Avg Deal Size',  fmt(k.average_deal_size||0),'Per won deal',                 '',      accents[6]]
		];
		document.getElementById('crm-metrics').innerHTML = cards.map(function (c) {
			return '<div class="crm-metric" style="--metric-accent:' + c[4] + '">' +
				'<div class="crm-metric-label">' + c[0] + '</div>' +
				'<div class="crm-metric-val ' + c[3] + '">' + c[1] + '</div>' +
				'<div class="crm-metric-sub">' + c[2] + '</div></div>';
		}).join('');
	};

	// ── Pipeline strip ────────────────────────────────────────────────

	CRMDashboard.prototype.render_pipeline = function () {
		var self = this;
		document.getElementById('crm-pipeline').innerHTML = this.funnel.map(function (row) {
			return '<div class="crm-stage" style="border-top-color:' + self.stage_color(row.stage) + '">' +
				'<div class="crm-stage-name" title="' + row.stage + '">' + row.stage + '</div>' +
				'<div class="crm-stage-count">' + row.count + '</div>' +
				'<div class="crm-stage-val">' + fmt(row.value) + '</div></div>';
		}).join('') || '<div class="crm-empty">No data</div>';
	};

	// ── Monthly trends ────────────────────────────────────────────────

	CRMDashboard.prototype.render_monthly_chart = function () {
		var ctx = document.getElementById('crm-monthly-chart');
		if (!ctx || !window.Chart || !this.monthly_trends.length) return;
		this.charts['monthly'] = new Chart(ctx, {
			type: 'line',
			data: {
				labels: this.monthly_trends.map(function (m) { return m.label; }),
				datasets: [
					{ label: 'Opportunities', data: this.monthly_trends.map(function(m){return m.opps;}),
					  borderColor: CHART_COLORS.blue, backgroundColor: 'rgba(59,130,246,0.08)',
					  tension: 0.4, fill: true, pointRadius: 3, pointHoverRadius: 5 },
					{ label: 'Leads', data: this.monthly_trends.map(function(m){return m.leads;}),
					  borderColor: CHART_COLORS.green, backgroundColor: 'rgba(16,185,129,0.08)',
					  tension: 0.4, fill: true, pointRadius: 3, pointHoverRadius: 5 }
				]
			},
			options: {
				responsive: true, maintainAspectRatio: false,
				plugins: { legend: { position:'top', labels:{ font:{size:11}, boxWidth:12, usePointStyle:true } } },
				scales: {
					x: { ticks:{ font:{size:9}, maxRotation:35 }, grid:{ display:false } },
					y: { ticks:{ font:{size:10}, stepSize:1, precision:0 }, grid:{ color:'rgba(0,0,0,0.05)' } }
				}
			}
		});
	};

	CRMDashboard.prototype.render_revenue_chart = function () {
		var ctx = document.getElementById('crm-revenue-chart');
		if (!ctx || !window.Chart || !this.monthly_trends.length) return;
		this.charts['revenue'] = new Chart(ctx, {
			type: 'bar',
			data: {
				labels: this.monthly_trends.map(function(m){return m.label;}),
				datasets: [
					{ label: 'Won value (₹)', type: 'bar',
					  data: this.monthly_trends.map(function(m){return m.won_value;}),
					  backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4, yAxisID: 'y' },
					{ label: 'Won deals', type: 'line',
					  data: this.monthly_trends.map(function(m){return m.won_count;}),
					  borderColor: CHART_COLORS.orange, backgroundColor: 'transparent',
					  tension: 0.4, pointRadius: 4, pointHoverRadius: 6, yAxisID: 'y1' }
				]
			},
			options: {
				responsive: true, maintainAspectRatio: false,
				plugins: { legend:{ position:'top', labels:{ font:{size:11}, boxWidth:12, usePointStyle:true } } },
				scales: {
					x: { ticks:{ font:{size:9}, maxRotation:35 }, grid:{ display:false } },
					y:  { position:'left',  ticks:{ font:{size:9} }, grid:{ color:'rgba(0,0,0,0.05)' } },
					y1: { position:'right', ticks:{ font:{size:9}, stepSize:1, precision:0 }, grid:{ display:false } }
				}
			}
		});
	};

	// ── Lead donut ────────────────────────────────────────────────────

	CRMDashboard.prototype.render_lead_chart = function () {
		var l = this.leads;
		var statuses = this.lead_statuses;
		var colors = ['#6B7280','#3B82F6','#10B981','#8B5CF6','#EC4899',
		              '#EF4444','#F59E0B','#14B8A6','#6366F1'];
		var counts = statuses.map(function(s){ return l.filter(function(x){return x.status===s;}).length; });
		var total  = counts.reduce(function(a,b){return a+b;},0);
		var ctx = document.getElementById('crm-lead-chart');
		if (!ctx) return;
		if (total===0){
			ctx.parentElement.innerHTML='<div class="crm-section-title">Lead status distribution</div><div class="crm-empty">No leads in selected period</div>';
			return;
		}
		if (!window.Chart) return;
		var active_s = statuses.filter(function(s,i){return counts[i]>0;});
		var active_c = counts.filter(function(c){return c>0;});
		var active_col = active_s.map(function(_,i){return colors[i%colors.length];});
		this.charts['lead'] = new Chart(ctx, {
			type: 'doughnut',
			data: { labels: active_s, datasets: [{ data: active_c, backgroundColor: active_col, borderWidth: 2, hoverOffset: 4 }] },
			options: {
				responsive: true, maintainAspectRatio: false,
				plugins: { legend:{ position:'right', labels:{ font:{size:11}, boxWidth:12, padding:10, usePointStyle:true } } }
			}
		});
	};

	// ── Source chart ─────────────────────────────────────────────────

	CRMDashboard.prototype.render_source_chart = function () {
		var ctx = document.getElementById('crm-source-chart');
		if (!ctx || !window.Chart) return;

		var all_stats = this.source_stats;
		var selection = this._src_selection;
		var stats = selection
			? all_stats.filter(function(s){ return selection.indexOf(s.source) !== -1; })
			: all_stats;

		// Sort by total desc
		stats = stats.slice().sort(function(a,b){
			return (b.opportunities+b.leads)-(a.opportunities+a.leads);
		});

		if (!stats.length){
			ctx.parentElement.querySelector('canvas').style.display='none';
			return;
		}
		ctx.style.display = '';

		if (this.charts['source']) { this.charts['source'].destroy(); delete this.charts['source']; }
		this.charts['source'] = new Chart(ctx, {
			type: 'bar',
			data: {
				labels: stats.map(function(s){ return s.source.length>16?s.source.slice(0,16)+'…':s.source; }),
				datasets: [
					{ label:'Opportunities', data:stats.map(function(s){return s.opportunities;}),
					  backgroundColor: CHART_COLORS.blue, borderRadius:4 },
					{ label:'Leads', data:stats.map(function(s){return s.leads;}),
					  backgroundColor: CHART_COLORS.green, borderRadius:4 }
				]
			},
			options: {
				responsive:true, maintainAspectRatio:false,
				plugins:{ legend:{ position:'top', labels:{ font:{size:11}, boxWidth:12, usePointStyle:true } } },
				scales:{
					x:{ ticks:{font:{size:9},maxRotation:40,autoSkip:false}, grid:{display:false} },
					y:{ ticks:{font:{size:10},stepSize:1,precision:0}, grid:{color:'rgba(0,0,0,0.05)'} }
				}
			}
		});
	};

	// ── Territory chart ───────────────────────────────────────────────

	CRMDashboard.prototype.render_territory = function () {
		var ctx = document.getElementById('crm-territory-chart');
		if (!ctx || !window.Chart) return;

		var all_stats = this.territory_stats;
		var selection = this._terr_selection;
		var stats = selection
			? all_stats.filter(function(t){ return selection.indexOf(t.territory) !== -1; })
			: all_stats;

		// Sort by total desc
		stats = stats.slice().sort(function(a,b){
			return (b.opportunities+b.leads)-(a.opportunities+a.leads);
		});

		if (!stats.length){
			ctx.style.display='none'; return;
		}
		ctx.style.display = '';

		if (this.charts['territory']) { this.charts['territory'].destroy(); delete this.charts['territory']; }
		this.charts['territory'] = new Chart(ctx, {
			type: 'bar',
			data: {
				labels: stats.map(function(t){ var n=t.territory||'-'; return n.length>14?n.slice(0,14)+'…':n; }),
				datasets: [
					{ label:'Opportunities', data:stats.map(function(t){return t.opportunities;}),
					  backgroundColor: CHART_COLORS.indigo, borderRadius:4 },
					{ label:'Leads', data:stats.map(function(t){return t.leads;}),
					  backgroundColor: CHART_COLORS.teal, borderRadius:4 }
				]
			},
			options: {
				responsive:true, maintainAspectRatio:false,
				plugins:{ legend:{ position:'top', labels:{ font:{size:11}, boxWidth:12, usePointStyle:true } } },
				scales:{
					x:{ ticks:{font:{size:10},maxRotation:35,autoSkip:false}, grid:{display:false} },
					y:{ ticks:{font:{size:10},stepSize:1,precision:0}, grid:{color:'rgba(0,0,0,0.05)'} }
				}
			}
		});
	};

	// ── Heatmap ───────────────────────────────────────────────────────

	CRMDashboard.prototype.set_metric = function (m, btn) {
		this.metric = m;
		document.querySelectorAll('.crm-toggle').forEach(function(b){b.classList.remove('active');});
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
		var found = this.salespersons.filter(function(sp){return sp.user===u;});
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

	// ── Salesperson performance ───────────────────────────────────────

	CRMDashboard.prototype.render_sp_perf = function () {
		var self=this;
		var container=document.getElementById('crm-sp-perf');
		if (!container) return;

		if (!this.is_mgr) {
			var me=this.salesperson_stats.filter(function(s){return s.owner===self.me;})[0];
			if (!me){ container.innerHTML='<div class="crm-empty">No data</div>'; return; }
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

		if (!this.salesperson_stats.length){
			container.innerHTML='<div class="crm-empty">No data for selected period</div>'; return;
		}

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

	registerPage();
})();
